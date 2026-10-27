import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth, type User } from '@/lib/auth';
import { Wordmark } from '@/assets/logo';
import { Spinner } from '@/components/ui';
import { money } from '@/lib/format';

interface PlanLimits {
  maxProperties: number;
  maxChannelConnections: number;
  maxUsers: number;
}
interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  currency: string;
  limits: PlanLimits;
}

export function SignupPage() {
  const { loginWithToken } = useAuth();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => api<{ plans: Plan[] }>('/plans'),
  });

  const [planCode, setPlanCode] = useState<string>('');
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState<'US' | 'CA'>('US');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plans = data?.plans ?? [];
  const selected = planCode || plans[0]?.code || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: User }>('/auth/signup', {
        method: 'POST',
        json: { organizationName, name, email, password, country, planCode: selected },
      });
      loginWithToken(r.token, r.user);
      nav('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4 dark:from-slate-950 dark:to-slate-900">
      <div className="card w-full max-w-2xl p-7">
        <Wordmark className="mb-1 text-lg" />
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Start your free trial — connect your first channels in minutes.
        </p>

        {isLoading ? (
          <Spinner />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label">Choose a plan</label>
              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((p) => (
                  <button
                    type="button"
                    key={p.code}
                    onClick={() => setPlanCode(p.code)}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected === p.code
                        ? 'border-brand-500 ring-2 ring-brand-500/30'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-lg font-bold">
                      {money(p.priceMonthlyCents / 100, p.currency)}
                      <span className="text-xs font-normal text-slate-400">/mo</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{p.description}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <li>
                        {p.limits.maxProperties >= 999 ? 'Unlimited' : `Up to ${p.limits.maxProperties}`}{' '}
                        {p.limits.maxProperties === 1 ? 'property' : 'properties'}
                      </li>
                      <li>{p.limits.maxChannelConnections >= 999 ? 'Unlimited' : `Up to ${p.limits.maxChannelConnections}`} channels</li>
                      <li>{p.limits.maxUsers} team members</li>
                    </ul>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">14-day trial, no card required. Upgrade any time.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Hotel / company name</label>
                <input className="input" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Country</label>
                <select className="input" value={country} onChange={(e) => setCountry(e.target.value as 'US' | 'CA')}>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              </div>
              <div>
                <label className="label">Your name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Work email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Password</label>
                <input
                  className="input"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            <button className="btn-primary w-full" disabled={busy || !selected}>
              {busy ? 'Creating your account…' : 'Start free trial'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-500 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
