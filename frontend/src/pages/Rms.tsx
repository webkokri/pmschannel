import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { Badge, Drawer, EmptyState, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';

interface Rule {
  id: string;
  name: string;
  type: 'occupancy_based' | 'day_of_week' | 'lead_time' | 'length_of_stay';
  conditions: Record<string, unknown>;
  adjustPct: number;
  priority: number;
  active: boolean;
  roomType: { name: string } | null;
}
interface LogRow {
  id: string;
  roomTypeId: string;
  date: string;
  ruleName: string;
  previousPrice: string;
  newPrice: string;
  reason: string;
  createdAt: string;
}
interface Suggestion {
  id: string;
  type: string;
  subject: string;
  content: string;
  status: 'new' | 'applied' | 'dismissed';
  createdAt: string;
}

export function RmsPage() {
  const { selectedId } = useProperty();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const rules = useQuery({
    queryKey: ['rms-rules', selectedId],
    queryFn: () => api<{ rules: Rule[] }>(`/rms/rules?propertyId=${selectedId}`),
    enabled: !!selectedId,
  });
  const log = useQuery({
    queryKey: ['rms-log'],
    queryFn: () => api<{ logs: LogRow[] }>('/rms/log'),
  });
  const suggestions = useQuery({
    queryKey: ['ai-suggestions'],
    queryFn: () => api<{ suggestions: Suggestion[] }>('/ai/suggestions?status=new'),
  });
  const aiStatus = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ configured: boolean }>('/ai/status') });

  const createRule = useMutation({
    mutationFn: (v: Record<string, unknown>) => api('/rms/rules', { method: 'POST', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rms-rules'] });
      setAdding(false);
    },
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/rms/rules/${id}`, { method: 'PATCH', json: { active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rms-rules'] }),
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api(`/rms/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rms-rules'] }),
  });
  const apply = useMutation({
    mutationFn: () => api<{ roomsScanned: number; datesChanged: number }>('/rms/apply', { method: 'POST', json: { propertyId: selectedId, days: 90 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rms-log'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
  const generateSuggestions = useMutation({
    mutationFn: () => api<{ created: number; message?: string }>('/ai/suggestions/generate', { method: 'POST', json: { propertyId: selectedId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-suggestions'] }),
  });
  const actOnSuggestion = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'applied' | 'dismissed' }) => api(`/ai/suggestions/${id}`, { method: 'PATCH', json: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-suggestions'] }),
  });

  if (!selectedId) return <EmptyState title="Select a property" />;

  return (
    <div>
      <PageHeader
        title="Revenue Management (RMS)"
        subtitle="Pricing rules that automatically reprice the calendar — runs nightly, or on demand"
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending ? 'Applying…' : 'Apply rules now'}
            </button>
            <button className="btn-primary" onClick={() => setAdding(true)}>
              + Rule
            </button>
          </div>
        }
      />

      {apply.data && (
        <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">
          Scanned {apply.data.roomsScanned} room type(s), repriced {apply.data.datesChanged} date(s).
        </p>
      )}
      {createRule.error && <ErrorNote error={createRule.error} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold">Rules</h3>
          {rules.isLoading && <Spinner />}
          {rules.error && <ErrorNote error={rules.error} />}
          {rules.data && (
            <Table
              head={
                <>
                  <th className="th">Name</th>
                  <th className="th">Room</th>
                  <th className="th">Type</th>
                  <th className="th">Adjust</th>
                  <th className="th">Active</th>
                  <th className="th" />
                </>
              }
            >
              {rules.data.rules.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.name}</td>
                  <td className="td text-slate-500">{r.roomType?.name ?? 'All rooms'}</td>
                  <td className="td text-slate-500">{r.type.replace(/_/g, ' ')}</td>
                  <td className={`td ${r.adjustPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {r.adjustPct >= 0 ? '+' : ''}
                    {r.adjustPct}%
                  </td>
                  <td className="td">
                    <input type="checkbox" checked={r.active} onChange={(e) => toggleRule.mutate({ id: r.id, active: e.target.checked })} />
                  </td>
                  <td className="td text-right">
                    <button className="text-rose-500 hover:underline" onClick={() => deleteRule.mutate(r.id)}>
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {rules.data.rules.length === 0 && (
                <tr>
                  <td className="td text-slate-500" colSpan={6}>
                    No pricing rules yet.
                  </td>
                </tr>
              )}
            </Table>
          )}

          <h3 className="mb-2 mt-6 text-sm font-semibold">Repricing log</h3>
          {log.data && (
            <Table
              head={
                <>
                  <th className="th">When</th>
                  <th className="th">Date</th>
                  <th className="th">Rule(s)</th>
                  <th className="th">Change</th>
                </>
              }
            >
              {log.data.logs.slice(0, 30).map((l) => (
                <tr key={l.id}>
                  <td className="td text-slate-500" title={dateTime(l.createdAt)}>
                    {timeAgo(l.createdAt)}
                  </td>
                  <td className="td">{l.date.slice(0, 10)}</td>
                  <td className="td text-slate-500">{l.ruleName}</td>
                  <td className="td">
                    ${l.previousPrice} → ${l.newPrice}
                  </td>
                </tr>
              ))}
              {log.data.logs.length === 0 && (
                <tr>
                  <td className="td text-slate-500" colSpan={4}>
                    No automatic repricing yet — add a rule and click "Apply rules now".
                  </td>
                </tr>
              )}
            </Table>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">AI suggestions</h3>
            <button className="btn-ghost !py-1.5" onClick={() => generateSuggestions.mutate()} disabled={generateSuggestions.isPending}>
              Generate
            </button>
          </div>
          {!aiStatus.data?.configured && (
            <p className="mb-2 text-xs text-amber-500">AI isn't configured on this server (no ANTHROPIC_API_KEY) — "Generate" will say so.</p>
          )}
          {generateSuggestions.data?.message && <p className="mb-2 text-xs text-slate-500">{generateSuggestions.data.message}</p>}
          <div className="space-y-2">
            {suggestions.data?.suggestions.map((s) => (
              <div key={s.id} className="card p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <Badge status={s.type === 'pricing' ? 'medium' : 'low'}>{s.type}</Badge>
                  <span className="text-xs text-slate-400">{timeAgo(s.createdAt)}</span>
                </div>
                <p className="font-medium">{s.subject}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.content}</p>
                <div className="mt-2 flex gap-2">
                  <button className="text-xs text-brand-500 hover:underline" onClick={() => actOnSuggestion.mutate({ id: s.id, status: 'applied' })}>
                    mark applied
                  </button>
                  <button className="text-xs text-slate-400 hover:underline" onClick={() => actOnSuggestion.mutate({ id: s.id, status: 'dismissed' })}>
                    dismiss
                  </button>
                </div>
              </div>
            ))}
            {suggestions.data?.suggestions.length === 0 && <p className="text-sm text-slate-500">No open suggestions.</p>}
          </div>
        </div>
      </div>

      {adding && (
        <Drawer open onClose={() => setAdding(false)} title="New pricing rule">
          <RuleForm propertyId={selectedId} busy={createRule.isPending} onSubmit={(v) => createRule.mutate(v)} />
        </Drawer>
      )}
    </div>
  );
}

function RuleForm({ propertyId, onSubmit, busy }: { propertyId: string; onSubmit: (v: Record<string, unknown>) => void; busy: boolean }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Rule['type']>('day_of_week');
  const [adjustPct, setAdjustPct] = useState('10');
  const [priority, setPriority] = useState('0');
  const [weekdays, setWeekdays] = useState<number[]>([5, 6]);
  const [minOcc, setMinOcc] = useState('80');
  const [maxOcc, setMaxOcc] = useState('100');
  const [maxDaysOut, setMaxDaysOut] = useState('2');
  const [minNights, setMinNights] = useState('2');

  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const conditions = () => {
    if (type === 'day_of_week') return { weekdays };
    if (type === 'occupancy_based') return { minOccupancyPct: Number(minOcc), maxOccupancyPct: Number(maxOcc) };
    if (type === 'lead_time') return { maxDaysOut: Number(maxDaysOut), minDaysOut: 0 };
    return { minNights: Number(minNights) };
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend premium" />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as Rule['type'])}>
          <option value="day_of_week">Day of week</option>
          <option value="occupancy_based">Occupancy-based</option>
          <option value="lead_time">Lead time (booking window)</option>
          <option value="length_of_stay">Length of stay</option>
        </select>
      </div>

      {type === 'day_of_week' && (
        <div>
          <label className="label">Applies on</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((d, i) => (
              <label key={i} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={weekdays.includes(i)}
                  onChange={(e) => setWeekdays(e.target.checked ? [...weekdays, i] : weekdays.filter((w) => w !== i))}
                />
                {d}
              </label>
            ))}
          </div>
        </div>
      )}
      {type === 'occupancy_based' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Min occupancy %</label>
            <input className="input" type="number" value={minOcc} onChange={(e) => setMinOcc(e.target.value)} />
          </div>
          <div>
            <label className="label">Max occupancy %</label>
            <input className="input" type="number" value={maxOcc} onChange={(e) => setMaxOcc(e.target.value)} />
          </div>
        </div>
      )}
      {type === 'lead_time' && (
        <div>
          <label className="label">Within how many days of check-in</label>
          <input className="input" type="number" value={maxDaysOut} onChange={(e) => setMaxDaysOut(e.target.value)} />
        </div>
      )}
      {type === 'length_of_stay' && (
        <div>
          <label className="label">Applies when min-stay policy is at least</label>
          <input className="input" type="number" value={minNights} onChange={(e) => setMinNights(e.target.value)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Adjustment % (negative = discount)</label>
          <input className="input" type="number" value={adjustPct} onChange={(e) => setAdjustPct(e.target.value)} />
        </div>
        <div>
          <label className="label">Priority (tie-break order)</label>
          <input className="input" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
      </div>

      <button
        className="btn-primary w-full"
        disabled={busy || !name}
        onClick={() => onSubmit({ propertyId, name, type, conditions: conditions(), adjustPct: Number(adjustPct), priority: Number(priority) })}
      >
        Create rule
      </button>
    </div>
  );
}
