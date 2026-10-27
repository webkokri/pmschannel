import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, getToken } from '@/api/client';
import { useProperty } from '@/lib/property';
import { EmptyState, ErrorNote, PageHeader, Spinner, Table } from '@/components/ui';

const REPORTS = [
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'revenue', label: 'Revenue by channel' },
  { key: 'booking-source', label: 'Booking source' },
] as const;

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { selectedId } = useProperty();
  const [report, setReport] = useState<(typeof REPORTS)[number]['key']>('occupancy');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', report, selectedId, from, to],
    queryFn: () => api<{ rows: Record<string, unknown>[] }>(`/reports/${report}?propertyId=${selectedId}&from=${from}&to=${to}`),
    enabled: !!selectedId,
  });

  const exportUrl = `/api/reports/${report}?propertyId=${selectedId}&from=${from}&to=${to}&format=csv`;

  const downloadCsv = async () => {
    const res = await fetch(exportUrl, { headers: { authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedId) return <EmptyState title="Select a property" />;

  const columns = data && data.rows.length > 0 ? Object.keys(data.rows[0]) : [];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Occupancy, revenue and booking-source reports, exportable to CSV"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn-ghost" onClick={downloadCsv} disabled={!data || data.rows.length === 0}>
              Export CSV
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {REPORTS.map((r) => (
          <button key={r.key} onClick={() => setReport(r.key)} className={r.key === report ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>
            {r.label}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote error={error} />}
      {data && (
        <Table head={<>{columns.map((c) => <th key={c} className="th capitalize">{c.replace(/([A-Z])/g, ' $1')}</th>)}</>}>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="td">
                  {typeof row[c] === 'number' && c.toLowerCase().includes('pct') ? `${row[c]}%` : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td className="td text-slate-500" colSpan={Math.max(columns.length, 1)}>
                No data for this range.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}
