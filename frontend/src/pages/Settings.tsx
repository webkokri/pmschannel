import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth, roleAtLeast } from '@/lib/auth';
import { Badge, ErrorNote, PageHeader, Spinner } from '@/components/ui';

interface EngineSettings {
  autoProtectOverbooking: boolean;
  detectRateMismatch: boolean;
  rateMismatchAbs: number;
  rateMismatchPct: number;
  defaultCurrency: string;
  stopSellOnZero: boolean;
  retryBackoffSec: number[];
}

interface Organization {
  id: string;
  name: string;
  logoUrl: string;
  brandColor: string;
  taxId: string;
  invoiceFooter: string;
  locale: string;
  contactEmail: string;
  currency: string;
  country: string;
}

const TABS = ['General', 'Conflict rules', 'Notifications', 'Payments'] as const;

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = roleAtLeast(user?.role, 'admin');
  const [tab, setTab] = useState<(typeof TABS)[number]>('General');

  return (
    <div>
      <PageHeader title="Settings" subtitle={isAdmin ? 'Organization profile, engine behaviour, notifications & payments' : 'Read-only — ask an admin to change these'} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={t === tab ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'General' && <GeneralTab isAdmin={isAdmin} />}
      {tab === 'Conflict rules' && <EngineTab isAdmin={isAdmin} />}
      {tab === 'Notifications' && <NotificationsTab isAdmin={isAdmin} />}
      {tab === 'Payments' && <PaymentsTab />}
    </div>
  );
}

function GeneralTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api<{ organization: Organization }>('/organization'),
  });
  const [form, setForm] = useState<Organization | null>(null);
  useEffect(() => {
    if (data) setForm(data.organization);
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Organization>) => api('/organization', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization'] }),
  });

  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const field = (k: keyof Organization, label: string, type = 'text') => (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className="input"
        disabled={!isAdmin}
        value={form[k] as string}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        onBlur={() => save.mutate({ [k]: form[k] })}
      />
    </div>
  );

  return (
    <div className="card grid gap-4 p-4 md:grid-cols-2">
      {field('name', 'Organization name')}
      {field('contactEmail', 'Contact email')}
      {field('logoUrl', 'Logo URL')}
      <div>
        <label className="label">Brand color</label>
        <input
          type="color"
          className="h-10 w-full rounded-lg border border-slate-300 dark:border-slate-700"
          disabled={!isAdmin}
          value={form.brandColor}
          onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
          onBlur={() => save.mutate({ brandColor: form.brandColor })}
        />
      </div>
      {field('taxId', 'Tax ID')}
      {field('locale', 'Locale (e.g. en-US)')}
      <div className="md:col-span-2">
        <label className="label">Invoice footer</label>
        <textarea
          className="input"
          rows={2}
          disabled={!isAdmin}
          value={form.invoiceFooter}
          onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })}
          onBlur={() => save.mutate({ invoiceFooter: form.invoiceFooter })}
        />
      </div>
      {save.isPending && <p className="text-xs text-slate-400 md:col-span-2">Saving…</p>}
    </div>
  );
}

function EngineTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ settings: EngineSettings }>('/settings'),
  });
  const [form, setForm] = useState<EngineSettings | null>(null);
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<EngineSettings>) => api('/settings', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const toggle = (k: keyof EngineSettings) => {
    const next = { ...form, [k]: !form[k] };
    setForm(next);
    save.mutate({ [k]: next[k] });
  };
  const setNum = (k: keyof EngineSettings, v: number) => {
    setForm({ ...form, [k]: v });
    save.mutate({ [k]: v });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold">Conflict prevention</h3>
        {(
          [
            ['autoProtectOverbooking', 'Auto-protect: reject inbound bookings that would oversell'],
            ['detectRateMismatch', 'Flag rate mismatches between bookings and the calendar'],
            ['stopSellOnZero', 'Close a room on all channels the moment it hits zero availability'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 text-sm">
            <span>{label}</span>
            <input type="checkbox" className="h-4 w-4" disabled={!isAdmin} checked={form[k]} onChange={() => toggle(k)} />
          </label>
        ))}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <label className="text-sm">
            <span className="label">Rate tolerance ($)</span>
            <input type="number" className="input" disabled={!isAdmin} value={form.rateMismatchAbs} onChange={(e) => setNum('rateMismatchAbs', Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="label">Rate tolerance (%)</span>
            <input type="number" step="0.01" className="input" disabled={!isAdmin} value={form.rateMismatchPct} onChange={(e) => setNum('rateMismatchPct', Number(e.target.value))} />
          </label>
        </div>
        {save.isPending && <p className="text-xs text-slate-400">Saving…</p>}
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Retry backoff</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Failed sync jobs retry after these delays (seconds), then move to <b>dead</b>.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {form.retryBackoffSec.map((s, i) => (
            <span key={i} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              #{i + 1}: {s}s
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface NotifyConfig {
  emailEnabled: boolean;
  smsEnabled: boolean;
  events: Record<string, { email: boolean; sms: boolean }>;
}

function NotificationsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['notify-config'],
    queryFn: () => api<{ config: NotifyConfig; emailConfigured: boolean; smsConfigured: boolean }>('/notifications/config'),
  });
  const [testTo, setTestTo] = useState('');
  const [testChannel, setTestChannel] = useState<'email' | 'sms'>('email');
  const [testResult, setTestResult] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<NotifyConfig>) => api('/notifications/config', { method: 'PATCH', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-config'] }),
  });
  const sendTest = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/notifications/test', { method: 'POST', json: { channel: testChannel, recipient: testTo } }),
    onSuccess: (r) => setTestResult(r.message),
  });

  if (isLoading || !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const { config } = data;
  const setEvent = (key: string, field: 'email' | 'sms', value: boolean) => {
    const events = { ...config.events, [key]: { ...config.events[key], [field]: value } };
    save.mutate({ events });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <h3 className="text-sm font-semibold">Channels</h3>
        <label className="flex items-center justify-between text-sm">
          <span>Email {!data.emailConfigured && <span className="text-xs text-amber-500">(SMTP not configured on server)</span>}</span>
          <input type="checkbox" disabled={!isAdmin} checked={config.emailEnabled} onChange={(e) => save.mutate({ emailEnabled: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between text-sm">
          <span>SMS {!data.smsConfigured && <span className="text-xs text-amber-500">(Twilio not configured on server)</span>}</span>
          <input type="checkbox" disabled={!isAdmin} checked={config.smsEnabled} onChange={(e) => save.mutate({ smsEnabled: e.target.checked })} />
        </label>

        <h3 className="pt-2 text-sm font-semibold">Events</h3>
        {Object.entries(config.events).map(([key, cfg]) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <span className="capitalize">{key.replace(/_/g, ' ')}</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" disabled={!isAdmin} checked={cfg.email} onChange={(e) => setEvent(key, 'email', e.target.checked)} /> email
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" disabled={!isAdmin} checked={cfg.sms} onChange={(e) => setEvent(key, 'sms', e.target.checked)} /> sms
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Send a test</h3>
        <div className="flex gap-2">
          <select className="input w-28" value={testChannel} onChange={(e) => setTestChannel(e.target.value as 'email' | 'sms')}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
          <input className="input" placeholder={testChannel === 'email' ? 'you@example.com' : '+15551234567'} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn-primary" disabled={sendTest.isPending || !testTo} onClick={() => sendTest.mutate()}>
            Send
          </button>
        </div>
        {testResult && <p className="mt-2 text-sm text-slate-500">{testResult}</p>}
        <p className="mt-3 text-xs text-slate-400">
          Configure SMTP_* / TWILIO_* environment variables on the server to enable real sending — until then, tests report
          "not configured" and every attempted send is still logged.
        </p>
      </div>
    </div>
  );
}

function PaymentsTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['payments-gateway'],
    queryFn: () => api<{ gateway: { name: string; configured: boolean }; connectStatus: string; commissionRateBps: number | null }>('/payments'),
  });
  const connect = useQuery({
    queryKey: ['connect-status'],
    queryFn: () => api<{ status: string; configured: boolean; hasAccount: boolean }>('/connect/status'),
  });
  const onboard = useMutation({
    mutationFn: () => api<{ ok: boolean; url?: string; message: string }>('/connect/onboard', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.ok && r.url) window.location.href = r.url;
      qc.invalidateQueries({ queryKey: ['connect-status'] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const status = connect.data?.status ?? data?.connectStatus ?? 'not_started';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Staff-initiated card charges</h3>
        <p className="text-sm">
          Provider: <b className="capitalize">{data?.gateway.name}</b> —{' '}
          {data?.gateway.configured ? (
            <span className="text-emerald-600 dark:text-emerald-400">configured</span>
          ) : (
            <span className="text-amber-500">not configured (set STRIPE_SECRET_KEY on the server)</span>
          )}
        </p>
        {data?.commissionRateBps != null && (
          <p className="mt-1 text-xs text-slate-500">Your negotiated commission rate: {(data.commissionRateBps / 100).toFixed(2)}%</p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Always Stripe — charge and refund a guest directly from a booking's detail view in Bookings. The direct-booking
          checkout gateway below (Stripe or Moneris) is separate and only applies to your public booking page.
        </p>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Payouts (Stripe Connect)</h3>
        <div className="flex items-center gap-2 text-sm">
          <span>Status:</span>
          <Badge status={status} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {status === 'active' &&
            'Your account is connected — after we deduct our commission, guest payments transfer to you automatically.'}
          {status === 'onboarding' && 'Onboarding started — finish the Stripe form to start receiving transfers.'}
          {status === 'restricted' && 'Stripe needs more information before payouts can resume. Restart onboarding below.'}
          {status === 'not_started' && 'Connect a payout account so guest payments (minus our commission) transfer to you automatically.'}
        </p>
        <button className="btn-primary mt-3" disabled={onboard.isPending} onClick={() => onboard.mutate()}>
          {status === 'not_started' ? 'Connect with Stripe' : 'Manage / continue onboarding'}
        </button>
        {onboard.data && !onboard.data.ok && <p className="mt-2 text-xs text-amber-500">{onboard.data.message}</p>}
      </div>

      <DirectBookingGatewayCard />
    </div>
  );
}

interface MonerisStatus {
  configured: boolean;
  storeId?: string;
  checkoutId?: string;
  environment?: string;
}

function DirectBookingGatewayCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['gateway-config'],
    queryFn: () => api<{ gateway: 'stripe' | 'moneris'; stripeConfigured: boolean; moneris: MonerisStatus }>('/payments/gateway-config'),
  });
  const [gateway, setGateway] = useState<'stripe' | 'moneris'>('stripe');
  const [moneris, setMoneris] = useState({ storeId: '', apiToken: '', checkoutId: '', environment: 'qa' as 'qa' | 'live' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setGateway(data.gateway);
      setMoneris((m) => ({ ...m, storeId: data.moneris.storeId ?? '', checkoutId: data.moneris.checkoutId ?? '', environment: (data.moneris.environment as 'qa' | 'live') ?? 'qa' }));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (json: Record<string, unknown>) => api('/payments/gateway-config', { method: 'PATCH', json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gateway-config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading || !data) return <div className="card p-4 lg:col-span-2"><Spinner /></div>;

  return (
    <div className="card p-4 lg:col-span-2">
      <h3 className="mb-2 text-sm font-semibold">Direct booking checkout (public booking page)</h3>
      <p className="mb-3 text-xs text-slate-500">
        Which gateway guests pay through when they book directly on your public page or embed. Stripe uses your Connect
        payout above; Moneris pays out to your own Moneris-linked account directly — we still record our commission for
        reporting, but don't collect it automatically for Moneris.
      </p>
      <div className="flex gap-2">
        {(['stripe', 'moneris'] as const).map((g) => (
          <button
            key={g}
            className={g === gateway ? 'btn-primary !py-1.5 capitalize' : 'btn-ghost !py-1.5 capitalize'}
            onClick={() => setGateway(g)}
          >
            {g}
          </button>
        ))}
      </div>

      {gateway === 'stripe' && (
        <p className="mt-3 text-xs text-slate-500">
          {data.stripeConfigured ? (
            <span className="text-emerald-600 dark:text-emerald-400">Stripe is configured on this server.</span>
          ) : (
            <span className="text-amber-500">Stripe is not configured on this server yet (no STRIPE_SECRET_KEY).</span>
          )}
        </p>
      )}

      {gateway === 'moneris' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Store ID</label>
            <input className="input" value={moneris.storeId} onChange={(e) => setMoneris({ ...moneris, storeId: e.target.value })} />
          </div>
          <div>
            <label className="label">API token</label>
            <input
              className="input"
              type="password"
              placeholder={data.moneris.configured ? 'saved — leave blank to keep' : 'not set'}
              value={moneris.apiToken}
              onChange={(e) => setMoneris({ ...moneris, apiToken: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Checkout ID</label>
            <input className="input" value={moneris.checkoutId} onChange={(e) => setMoneris({ ...moneris, checkoutId: e.target.value })} />
          </div>
          <div>
            <label className="label">Environment</label>
            <select className="input" value={moneris.environment} onChange={(e) => setMoneris({ ...moneris, environment: e.target.value as 'qa' | 'live' })}>
              <option value="qa">Test (qa)</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              gateway,
              ...(gateway === 'moneris' ? { moneris: { ...moneris, apiToken: moneris.apiToken || undefined } } : {}),
            })
          }
        >
          Save
        </button>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
    </div>
  );
}
