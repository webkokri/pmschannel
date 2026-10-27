import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Badge, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { roleAtLeast, useAuth } from '@/lib/auth';

interface PlanLimits {
  maxProperties: number;
  maxRoomTypesPerProperty: number;
  maxChannelConnections: number;
  maxUsers: number;
  channelCategories: string[];
}
interface Plan {
  code: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  description: string;
  limits: PlanLimits;
}
interface Me {
  organization: { name: string; status: string; trialEndsAt: string | null };
  subscription: { status: string; billingCycle: string; plan: Plan } | null;
  pendingPlan: Plan | null;
  usage: { plan: { name: string; limits: PlanLimits }; usage: { properties: number; channelConnections: number; users: number } };
  supportManager: { name: string; email: string } | null;
  stripeConfigured: boolean;
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const unlimited = limit >= 999;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{label}</span>
        <span>{unlimited ? `${used} used` : `${used} / ${limit}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${pct >= 100 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-brand-500'}`}
          style={{ width: unlimited ? '8%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function BillingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = roleAtLeast(user?.role, 'admin');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['billing-me'],
    queryFn: () => api<Me>('/billing/me'),
  });
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api<{ plans: Plan[] }>('/plans') });

  const changePlan = useMutation({
    mutationFn: (planCode: string) => api<{ applied: boolean; checkoutUrl?: string; message: string }>('/billing/change-plan', { method: 'POST', json: { planCode } }),
    onSuccess: (r) => {
      setMessage(r.message);
      if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
      qc.invalidateQueries({ queryKey: ['billing-me'] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Could not change plan'),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? 'error'} />;

  const currentCode = data.subscription?.plan.code;

  return (
    <div>
      <PageHeader
        title="Billing & plan"
        subtitle={`${data.organization.name} · ${data.organization.status}${
          data.organization.trialEndsAt ? ` · trial ends ${new Date(data.organization.trialEndsAt).toLocaleDateString()}` : ''
        }`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Current plan</h3>
            {data.subscription && <Badge status={data.subscription.status} />}
          </div>
          {data.subscription ? (
            <>
              <p className="text-2xl font-semibold">{data.subscription.plan.name}</p>
              <p className="text-sm text-slate-500">
                {money(data.subscription.plan.priceMonthlyCents / 100, data.subscription.plan.currency)}/mo
              </p>
              {data.pendingPlan && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  Upgrade to {data.pendingPlan.name} requested — your support manager will follow up to complete it.
                </p>
              )}
              <div className="mt-4 space-y-3">
                <UsageBar label="Properties" used={data.usage.usage.properties} limit={data.usage.plan.limits.maxProperties} />
                <UsageBar label="Connected channels" used={data.usage.usage.channelConnections} limit={data.usage.plan.limits.maxChannelConnections} />
                <UsageBar label="Team members" used={data.usage.usage.users} limit={data.usage.plan.limits.maxUsers} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">No subscription found.</p>
          )}
          {message && <p className="mt-3 text-sm text-brand-600 dark:text-brand-400">{message}</p>}
          {!data.stripeConfigured && (
            <p className="mt-3 text-xs text-slate-400">
              Payments aren't connected on this deployment yet — upgrades are recorded for your support manager to action.
            </p>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Your dedicated support manager</h3>
          {data.supportManager ? (
            <>
              <p className="font-medium">{data.supportManager.name}</p>
              <p className="text-sm text-slate-500">{data.supportManager.email}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Not assigned yet — check back soon.</p>
          )}
        </div>
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold">Available plans</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {plans.data?.plans.map((p) => (
          <div key={p.code} className={`card p-4 ${p.code === currentCode ? 'ring-2 ring-brand-500' : ''}`}>
            <p className="font-semibold">{p.name}</p>
            <p className="text-xl font-bold">
              {money(p.priceMonthlyCents / 100, p.currency)}
              <span className="text-xs font-normal text-slate-400">/mo</span>
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{p.description}</p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <li>{p.limits.maxProperties >= 999 ? 'Unlimited' : `Up to ${p.limits.maxProperties}`} properties</li>
              <li>{p.limits.maxChannelConnections >= 999 ? 'Unlimited' : `Up to ${p.limits.maxChannelConnections}`} channels</li>
              <li>{p.limits.maxUsers} team members</li>
            </ul>
            <button
              className="btn-primary mt-3 w-full !py-1.5"
              disabled={!isAdmin || p.code === currentCode || changePlan.isPending}
              onClick={() => changePlan.mutate(p.code)}
            >
              {p.code === currentCode ? 'Current plan' : 'Switch to this plan'}
            </button>
          </div>
        ))}
      </div>
      {!isAdmin && <p className="mt-2 text-xs text-slate-400">Only an organization admin can change plans.</p>}
    </div>
  );
}
