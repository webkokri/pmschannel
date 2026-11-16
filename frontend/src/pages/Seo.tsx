import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { CopyButton, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';

interface Seo {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  ogImageUrl: string;
  published: boolean;
}
interface Faq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export function SeoPage() {
  const { selectedId, selected } = useProperty();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['seo', selectedId],
    queryFn: () => api<{ seo: Seo; faqs: Faq[] }>(`/seo/${selectedId}`),
    enabled: !!selectedId,
  });
  const [form, setForm] = useState<Seo | null>(null);
  useEffect(() => {
    if (data) setForm(data.seo);
  }, [data]);

  const save = useMutation({
    mutationFn: (v: Seo) => api(`/seo/${selectedId}`, { method: 'PUT', json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });
  const addFaq = useMutation({
    mutationFn: (v: { question: string; answer: string }) => api(`/seo/${selectedId}/faqs`, { method: 'POST', json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });
  const deleteFaq = useMutation({
    mutationFn: (id: string) => api(`/seo/faqs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });

  const [q, setQ] = useState('');
  const [a, setA] = useState('');

  if (!selectedId) return <EmptyState title="Select a property" />;
  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const publicUrl = `${location.origin}/book/${selected?.code}`;
  const embedCode = `<iframe src="${publicUrl}" width="100%" height="900" style="border:0" loading="lazy" title="Book ${selected?.name ?? ''}"></iframe>`;

  return (
    <div>
      <PageHeader
        title="SEO / GEO / AEO"
        subtitle="Public booking page content — search engines, and AI answer engines, read this"
        actions={
          form.published && (
            <a className="btn-ghost" href={publicUrl} target="_blank" rel="noreferrer">
              View public page ↗
            </a>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <label className="flex items-center justify-between text-sm">
            <span>
              Published{' '}
              {!form.published && <span className="text-xs text-amber-500">(page returns 404 until published)</span>}
            </span>
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          </label>
          <div>
            <label className="label">Meta title</label>
            <input className="input" value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} />
          </div>
          <div>
            <label className="label">Meta description</label>
            <textarea className="input" rows={2} value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} />
          </div>
          <div>
            <label className="label">Keywords (comma-separated)</label>
            <input
              className="input"
              value={form.keywords.join(', ')}
              onChange={(e) => setForm({ ...form, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })}
            />
          </div>
          <div>
            <label className="label">Social share image URL</label>
            <input className="input" value={form.ogImageUrl} onChange={(e) => setForm({ ...form, ogImageUrl: e.target.value })} />
          </div>
          <button className="btn-primary w-full" onClick={() => save.mutate(form)} disabled={save.isPending}>
            Save
          </button>
          <p className="text-xs text-slate-400">
            Guests booking there flow through the same conflict-checked pipeline as every other channel (as "Direct
            website booking engine") — connect and map that channel first.
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">FAQs (shown with FAQPage structured data)</h3>
          <div className="space-y-2">
            {data?.faqs.map((f) => (
              <div key={f.id} className="card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{f.question}</p>
                  <button className="text-xs text-rose-500 hover:underline" onClick={() => deleteFaq.mutate(f.id)}>
                    delete
                  </button>
                </div>
                <p className="text-slate-500 dark:text-slate-400">{f.answer}</p>
              </div>
            ))}
          </div>
          <div className="card mt-3 space-y-2 p-3">
            <input className="input" placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} />
            <textarea className="input" placeholder="Answer" rows={2} value={a} onChange={(e) => setA(e.target.value)} />
            <button
              className="btn-ghost w-full"
              disabled={!q || !a || addFaq.isPending}
              onClick={() => {
                addFaq.mutate({ question: q, answer: a });
                setQ('');
                setA('');
              }}
            >
              + Add FAQ
            </button>
          </div>
        </div>
      </div>

      <div className="card mt-4 space-y-4 p-4">
        <h3 className="text-sm font-semibold">Link & embed</h3>
        {!form.published && (
          <p className="text-xs text-amber-500">Publish this page above before sharing the link or embed — both 404 until then.</p>
        )}
        <div>
          <label className="label">Direct link</label>
          <div className="flex gap-2">
            <input className="input flex-1" readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
            <CopyButton text={publicUrl} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Share this anywhere — social bio, email signature, a QR code at the front desk.</p>
        </div>
        <div>
          <label className="label">Embed on your own website</label>
          <div className="flex items-start gap-2">
            <textarea
              className="input flex-1 font-mono text-xs"
              rows={3}
              readOnly
              value={embedCode}
              onFocus={(e) => e.target.select()}
            />
            <CopyButton text={embedCode} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Paste this snippet into your own site (Wix, Squarespace, WordPress — anywhere that accepts custom HTML). It
            shows the same search-and-book page inline, including live availability and payment if you've configured a
            checkout gateway in Settings → Payments.
          </p>
        </div>
      </div>
    </div>
  );
}
