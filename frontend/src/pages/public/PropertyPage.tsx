import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wordmark } from '@/assets/logo';

interface CalendarDay {
  date: string;
  price: number;
  available: boolean;
  minStay: number;
}
interface RoomType {
  id: string;
  name: string;
  category: string;
  maxOccupancy: number;
  basePrice: number;
  calendar: CalendarDay[];
}
interface PublicProperty {
  paymentGateway: { configured: boolean; name: string };
  property: { code: string; name: string; city: string; region: string; country: string; currency: string };
  seo: { metaTitle: string; metaDescription: string; keywords: string[]; ogImageUrl: string };
  faqs: { question: string; answer: string }[];
  roomTypes: RoomType[];
}

async function fetchPublic(code: string): Promise<PublicProperty> {
  const res = await fetch(`/api/public/properties/${code}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'This property page is not available.' : 'Failed to load');
  return res.json();
}

/** Injects/updates a <meta> tag and returns a cleanup that restores nothing (page is
 *  single-purpose, so we don't bother reverting on unmount). */
function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface SearchResult {
  room: RoomType;
  nights: number;
  total: number;
  dated: boolean;
  fitsParty: boolean;
  available: boolean;
}

type CheckoutState =
  | { phase: 'idle' }
  | { phase: 'redirecting' }
  | { phase: 'widget'; ref: string }
  | { phase: 'finalizing'; ref: string }
  | { phase: 'done'; status: 'completed' | 'rejected' }
  | { phase: 'error'; message: string };

export function PublicPropertyPage() {
  const { code = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-property', code],
    queryFn: () => fetchPublic(code),
    retry: false,
  });

  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso(), 2));
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [searched, setSearched] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [freeResult, setFreeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ phase: 'idle' });

  useEffect(() => {
    if (!data) return;
    document.title = data.seo.metaTitle || data.property.name;
    setMeta('description', data.seo.metaDescription);
    setMeta('keywords', data.seo.keywords.join(', '));
    setMeta('og:title', data.seo.metaTitle, 'property');
    setMeta('og:description', data.seo.metaDescription, 'property');
    if (data.seo.ogImageUrl) setMeta('og:image', data.seo.ogImageUrl, 'property');

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-json-property';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'LodgingBusiness',
          name: data.property.name,
          address: { '@type': 'PostalAddress', addressLocality: data.property.city, addressRegion: data.property.region, addressCountry: data.property.country },
        },
        data.faqs.length > 0 && {
          '@type': 'FAQPage',
          mainEntity: data.faqs.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer },
          })),
        },
      ].filter(Boolean),
    });
    document.getElementById('ld-json-property')?.remove();
    document.head.appendChild(script);
    return () => {
      document.getElementById('ld-json-property')?.remove();
    };
  }, [data]);

  // Returning from a Stripe redirect (?checkout=success&ref=...) or a cancel.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('checkout');
    const ref = params.get('ref');
    if (outcome === 'success' && ref) setCheckout({ phase: 'finalizing', ref });
    else if (outcome === 'cancelled') setCheckout({ phase: 'error', message: 'Checkout was cancelled — no payment was taken.' });
  }, []);

  // Poll for the webhook to finish finalizing the booking after a Stripe redirect back.
  useEffect(() => {
    if (checkout.phase !== 'finalizing') return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/public/bookings/checkout-status/${checkout.ref}`);
        const body = await res.json();
        if (body.status === 'completed' || body.status === 'rejected') {
          setCheckout({ phase: 'done', status: body.status });
          clearInterval(timer);
        } else if (attempts > 15) {
          setCheckout({ phase: 'error', message: "Still confirming your payment — refresh this page in a moment, or check your email." });
          clearInterval(timer);
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [checkout]);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    return Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
  }, [checkIn, checkOut]);

  const results: SearchResult[] = useMemo(() => {
    if (!data || nights === 0) return [];
    return data.roomTypes.map((room) => {
      const days = room.calendar.filter((d) => d.date >= checkIn && d.date < checkOut);
      const dated = days.length === nights && days.every((d) => d.available);
      const fitsParty = room.maxOccupancy * rooms >= adults + children;
      const perRoomTotal = days.length === nights ? days.reduce((s, d) => s + d.price, 0) : room.basePrice * nights;
      return { room, nights, total: perRoomTotal * rooms, dated, fitsParty, available: dated && fitsParty };
    });
  }, [data, checkIn, checkOut, nights, rooms, adults, children]);

  const selected = results.find((r) => r.room.id === roomId);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(true);
    setRoomId('');
  };

  const bookFree = async () => {
    if (!selected) return;
    setSubmitting(true);
    setFreeResult(null);
    try {
      const res = await fetch(`/api/public/bookings/${code}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomTypeId: roomId, checkIn, checkOut, guestName, guestEmail, guestPhone, units: rooms, adults, children }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not complete booking');
      setFreeResult({ ok: true, message: `Booked! Confirmation ${body.reference}. Total ${body.amount} ${body.currency}.` });
    } catch (err) {
      setFreeResult({ ok: false, message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSubmitting(false);
    }
  };

  const startPaidCheckout = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/bookings/${code}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomTypeId: roomId, checkIn, checkOut, guestName, guestEmail, guestPhone, units: rooms, adults, children }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not start checkout');

      if (body.mode === 'redirect') {
        setCheckout({ phase: 'redirecting' });
        window.location.href = body.url;
        return;
      }
      if (body.mode === 'widget') {
        setCheckout({ phase: 'widget', ref: body.checkoutRef });
        loadMonerisWidget(body.ticket, body.environment, async () => {
          setCheckout({ phase: 'finalizing', ref: body.checkoutRef });
          try {
            const complete = await fetch(`/api/public/bookings/checkout/${body.checkoutRef}/moneris-complete`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ticket: body.ticket }),
            });
            const completeBody = await complete.json();
            if (!complete.ok) throw new Error(completeBody.error ?? 'Could not verify payment');
            setCheckout({ phase: 'done', status: completeBody.status });
          } catch (err) {
            setCheckout({ phase: 'error', message: err instanceof Error ? err.message : 'Could not verify payment' });
          }
        });
      }
    } catch (err) {
      setCheckout({ phase: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (data?.paymentGateway.configured) startPaidCheckout();
    else bookFree();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950">Loading…</div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <Wordmark className="mb-4 justify-center text-lg" />
          <p className="text-slate-500">{error instanceof Error ? error.message : 'Property not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Wordmark className="text-base" />
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{data.property.name}</h1>
        <p className="text-slate-500">
          {data.property.city}, {data.property.region}, {data.property.country}
        </p>

        {checkout.phase !== 'idle' ? (
          <CheckoutStatusPanel state={checkout} />
        ) : (
          <>
            <form onSubmit={search} className="card mt-6 flex flex-wrap items-end gap-3 p-4">
              <div>
                <label className="label">Check-in</label>
                <input required type="date" className="input" value={checkIn} min={todayIso()} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div>
                <label className="label">Check-out</label>
                <input required type="date" className="input" value={checkOut} min={addDaysIso(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} />
              </div>
              <div>
                <label className="label">Rooms</label>
                <input
                  required
                  type="number"
                  min={1}
                  max={9}
                  className="input w-20"
                  value={rooms}
                  onChange={(e) => setRooms(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div>
                <label className="label">Adults</label>
                <input
                  required
                  type="number"
                  min={1}
                  max={20}
                  className="input w-20"
                  value={adults}
                  onChange={(e) => setAdults(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div>
                <label className="label">Children</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  className="input w-20"
                  value={children}
                  onChange={(e) => setChildren(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <button className="btn-primary" type="submit">
                Search availability
              </button>
            </form>

            {searched && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {results.map((r) => (
                  <button
                    key={r.room.id}
                    disabled={!r.available}
                    onClick={() => setRoomId(r.room.id)}
                    className={`card rounded-xl border p-4 text-left transition ${
                      !r.available
                        ? 'cursor-not-allowed opacity-50'
                        : roomId === r.room.id
                          ? 'border-brand-500 ring-2 ring-brand-500/30'
                          : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <p className="font-semibold">{r.room.name}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      {r.room.category} · sleeps {r.room.maxOccupancy} per room
                    </p>
                    {r.available ? (
                      <p className="mt-2 text-lg font-bold">
                        {data.property.currency} {r.total.toFixed(0)}
                        <span className="text-xs font-normal text-slate-400">
                          {' '}
                          / {r.nights} night{r.nights === 1 ? '' : 's'}
                          {rooms > 1 && ` · ${rooms} rooms`}
                        </span>
                      </p>
                    ) : !r.dated ? (
                      <p className="mt-2 text-sm text-rose-500">Not available for these dates</p>
                    ) : (
                      <p className="mt-2 text-sm text-rose-500">Doesn't fit {adults + children} guests — add another room</p>
                    )}
                  </button>
                ))}
                {results.every((r) => !r.available) && (
                  <p className="text-sm text-slate-500 md:col-span-2">
                    No rooms match — try different dates, fewer guests, or more rooms.
                  </p>
                )}
              </div>
            )}

            {selected && (
              <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
                <h2 className="font-semibold">
                  {selected.room.name} · {selected.nights} night{selected.nights === 1 ? '' : 's'} · {data.property.currency}{' '}
                  {selected.total.toFixed(0)}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Your name</label>
                    <input required className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input required type="email" className="input" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Phone</label>
                    <input required type="tel" className="input" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
                  </div>
                  <div className="flex items-end text-sm text-slate-500">
                    {adults + children} guest{adults + children === 1 ? '' : 's'} ({adults} adult{adults === 1 ? '' : 's'}
                    {children > 0 && `, ${children} child${children === 1 ? '' : 'ren'}`}) · {rooms} room{rooms === 1 ? '' : 's'}
                  </div>
                </div>
                {freeResult && (
                  <p className={freeResult.ok ? 'text-sm text-emerald-600 dark:text-emerald-400' : 'text-sm text-rose-600 dark:text-rose-400'}>
                    {freeResult.message}
                  </p>
                )}
                <button className="btn-primary w-full" disabled={submitting}>
                  {submitting
                    ? 'Starting checkout…'
                    : data.paymentGateway.configured
                      ? `Pay & book — ${data.property.currency} ${selected.total.toFixed(0)}`
                      : 'Request booking'}
                </button>
                {!data.paymentGateway.configured && (
                  <p className="text-xs text-slate-400">Pay-at-property — no card needed to confirm this booking.</p>
                )}
              </form>
            )}
          </>
        )}

        {data.faqs.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">Frequently asked questions</h2>
            <div className="space-y-3">
              {data.faqs.map((f, i) => (
                <div key={i} className="card p-4">
                  <p className="font-medium">{f.question}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{f.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function CheckoutStatusPanel({ state }: { state: CheckoutState }) {
  return (
    <div className="card mt-6 space-y-3 p-6 text-center">
      {state.phase === 'redirecting' && <p>Redirecting you to a secure payment page…</p>}
      {state.phase === 'widget' && <div id="moneris-checkout" className="min-h-[480px]" />}
      {state.phase === 'finalizing' && <p>Confirming your payment and finalizing your booking…</p>}
      {state.phase === 'done' && state.status === 'completed' && (
        <p className="text-emerald-600 dark:text-emerald-400">
          Payment received and your booking is confirmed — a confirmation email is on its way.
        </p>
      )}
      {state.phase === 'done' && state.status === 'rejected' && (
        <p className="text-amber-600 dark:text-amber-400">
          Sorry — that room sold out while your payment was processing. You've been refunded in full; please search again
          for different dates.
        </p>
      )}
      {state.phase === 'error' && <p className="text-rose-600 dark:text-rose-400">{state.message}</p>}
    </div>
  );
}

/**
 * Loads Moneris's Checkout.js and starts the hosted lightbox for `ticket`. This mirrors
 * Moneris Checkout's documented client-side integration (script URL, `monerisCheckout`
 * global, `setCallback` event names) — not exercised against a real Moneris test store in
 * this build; verify against Moneris's current developer docs before going live.
 */
function loadMonerisWidget(ticket: string, environment: string, onSuccess: () => void) {
  const scriptSrc =
    environment === 'live'
      ? 'https://gateway.moneris.com/chkt/js/chkt_v2.00.js'
      : 'https://gatewayt.moneris.com/chkt/js/chkt_v2.00.js';

  const start = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const checkout = new w.monerisCheckout();
    checkout.setMode(environment === 'live' ? 'prod' : 'qa');
    checkout.setCheckoutDiv('moneris-checkout');
    checkout.setCallback('page_loaded', () => undefined);
    checkout.setCallback('cancel_transaction', () => undefined);
    checkout.setCallback('error_event', () => undefined);
    checkout.setCallback('payment_receipt', () => onSuccess());
    checkout.startCheckout(ticket);
  };

  if (document.getElementById('moneris-checkout-js')) {
    start();
    return;
  }
  const script = document.createElement('script');
  script.id = 'moneris-checkout-js';
  script.src = scriptSrc;
  script.onload = start;
  document.body.appendChild(script);
}
