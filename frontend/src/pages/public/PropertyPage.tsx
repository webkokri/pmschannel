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

export function PublicPropertyPage() {
  const { code = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['public-property', code],
    queryFn: () => fetchPublic(code),
    retry: false,
  });

  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!data) return;
    document.title = data.seo.metaTitle || data.property.name;
    setMeta('description', data.seo.metaDescription);
    setMeta('keywords', data.seo.keywords.join(', '));
    setMeta('og:title', data.seo.metaTitle, 'property');
    setMeta('og:description', data.seo.metaDescription, 'property');
    if (data.seo.ogImageUrl) setMeta('og:image', data.seo.ogImageUrl, 'property');

    // JSON-LD structured data — LodgingBusiness + FAQPage (SEO/GEO/AEO surface).
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

  const selectedRoom = useMemo(() => data?.roomTypes.find((r) => r.id === roomId), [data, roomId]);
  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    return Math.max(0, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000));
  }, [checkIn, checkOut]);
  const estimate = useMemo(() => {
    if (!selectedRoom || nights === 0) return 0;
    const days = selectedRoom.calendar.filter((d) => d.date >= checkIn && d.date < checkOut);
    if (days.length === nights) return days.reduce((s, d) => s + d.price, 0);
    return selectedRoom.basePrice * nights;
  }, [selectedRoom, checkIn, checkOut, nights]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/public/bookings/${code}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomTypeId: roomId, checkIn, checkOut, guestName, guestEmail }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not complete booking');
      setResult({ ok: true, message: `Booked! Confirmation ${body.reference}. Total ${body.amount} ${body.currency}.` });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSubmitting(false);
    }
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

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {data.roomTypes.map((r) => (
            <button
              key={r.id}
              onClick={() => setRoomId(r.id)}
              className={`card rounded-xl border p-4 text-left transition ${
                roomId === r.id ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs uppercase tracking-wide text-slate-400">{r.category} · sleeps {r.maxOccupancy}</p>
              <p className="mt-2 text-lg font-bold">
                from ${Math.min(...r.calendar.map((d) => d.price), r.basePrice)}
                <span className="text-xs font-normal text-slate-400">/night</span>
              </p>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="card mt-8 space-y-4 p-5">
          <h2 className="font-semibold">Book direct</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Check-in</label>
              <input required type="date" className="input" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div>
              <label className="label">Check-out</label>
              <input required type="date" className="input" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
            <div>
              <label className="label">Your name</label>
              <input required className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input required type="email" className="input" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
            </div>
          </div>
          {!roomId && <p className="text-sm text-amber-500">Pick a room above first.</p>}
          {nights > 0 && selectedRoom && <p className="text-sm text-slate-500">{nights} night(s) · estimated total ${estimate}</p>}
          {result && (
            <p className={result.ok ? 'text-sm text-emerald-600 dark:text-emerald-400' : 'text-sm text-rose-600 dark:text-rose-400'}>
              {result.message}
            </p>
          )}
          <button className="btn-primary w-full" disabled={!roomId || submitting}>
            {submitting ? 'Booking…' : 'Request booking'}
          </button>
        </form>

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
