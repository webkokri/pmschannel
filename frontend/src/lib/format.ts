export function money(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
}

export function pct(n: number) {
  return `${Math.round((n || 0) * 100)}%`;
}

export function date(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortDate(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dateTime(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const secs = Math.round((Date.now() - dt.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  modified: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  connected: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  disconnected: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  pending: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  running: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  succeeded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  dead: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  open: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  acknowledged: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  low: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  critical: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  onboarding: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  restricted: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  not_started: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  captured: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  partially_refunded: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  refunded: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export function statusBadge(status: string) {
  return STATUS_COLORS[status] ?? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}
