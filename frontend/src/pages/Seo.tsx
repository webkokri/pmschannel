import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';
import { useAuth, roleAtLeast } from '@/lib/auth';
import { CopyButton, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';

const TABS = ['Page builder', 'SEO', 'FAQs', 'Link & embed'] as const;

export function SeoPage() {
  const { selectedId, selected } = useProperty();
  const { user } = useAuth();
  const isAdmin = roleAtLeast(user?.role, 'admin');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Page builder');

  if (!selectedId) return <EmptyState title="Select a property" />;

  return (
    <div>
      <PageHeader
        title="Website & booking page"
        subtitle={
          isAdmin
            ? 'Design the public booking page, its SEO content, and get the embed code for your own website'
            : 'Read-only — only an organization admin can design this page'
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={t === tab ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Page builder' && <PageBuilderTab propertyId={selectedId} code={selected?.code ?? ''} isAdmin={isAdmin} />}
      {tab === 'SEO' && <SeoTab propertyId={selectedId} code={selected?.code ?? ''} isAdmin={isAdmin} />}
      {tab === 'FAQs' && <FaqsTab propertyId={selectedId} isAdmin={isAdmin} />}
      {tab === 'Link & embed' && <EmbedTab code={selected?.code ?? ''} name={selected?.name ?? ''} />}
    </div>
  );
}

// ── Page builder ─────────────────────────────────────────────────────────────

interface Section {
  id: string;
  heading: string;
  body: string;
}
interface PageContent {
  heroHeadline: string;
  heroSubheadline: string;
  heroImageUrl: string;
  primaryColor: string;
  aboutText: string;
  amenities: string[];
  galleryImageUrls: string[];
  sections: Section[];
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function PageBuilderTab({ propertyId, code, isAdmin }: { propertyId: string; code: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['page-content', propertyId],
    queryFn: () => api<{ content: PageContent }>(`/page-builder/${propertyId}`),
  });
  const [form, setForm] = useState<PageContent | null>(null);
  const [amenityInput, setAmenityInput] = useState('');
  const [galleryInput, setGalleryInput] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    if (data) setForm(data.content);
  }, [data]);

  const save = useMutation({
    mutationFn: (v: PageContent) => api(`/page-builder/${propertyId}`, { method: 'PUT', json: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['page-content', propertyId] });
      setPreviewKey((k) => k + 1);
    },
  });

  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const move = <T,>(arr: T[], from: number, to: number): T[] => {
    const copy = [...arr];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Hero</h3>
          <div>
            <label className="label">Headline</label>
            <input
              className="input"
              disabled={!isAdmin}
              placeholder={`Welcome to ${code || 'your property'}`}
              value={form.heroHeadline}
              onChange={(e) => setForm({ ...form, heroHeadline: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Subheadline</label>
            <input
              className="input"
              disabled={!isAdmin}
              placeholder="A short line under the headline"
              value={form.heroSubheadline}
              onChange={(e) => setForm({ ...form, heroSubheadline: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Hero image URL</label>
            <input
              className="input"
              disabled={!isAdmin}
              value={form.heroImageUrl}
              onChange={(e) => setForm({ ...form, heroImageUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Accent color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                disabled={!isAdmin}
                className="h-9 w-14 rounded border border-slate-300 dark:border-slate-700"
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              />
              <span className="text-xs text-slate-500">Used for the "Search" and "Book" buttons</span>
            </div>
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">About</h3>
          <textarea
            className="input"
            rows={4}
            disabled={!isAdmin}
            placeholder="Tell guests what makes this property worth booking directly."
            value={form.aboutText}
            onChange={(e) => setForm({ ...form, aboutText: e.target.value })}
          />
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Amenities</h3>
          <div className="flex flex-wrap gap-1.5">
            {form.amenities.map((a, i) => (
              <span key={i} className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {a}
                {isAdmin && (
                  <button className="ml-1.5 text-rose-500" onClick={() => setForm({ ...form, amenities: form.amenities.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                )}
              </span>
            ))}
            {form.amenities.length === 0 && <span className="text-sm text-slate-500">None added yet.</span>}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="e.g. Free WiFi"
                value={amenityInput}
                onChange={(e) => setAmenityInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && amenityInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, amenities: [...form.amenities, amenityInput.trim()] });
                    setAmenityInput('');
                  }
                }}
              />
              <button
                className="btn-ghost"
                disabled={!amenityInput.trim()}
                onClick={() => {
                  setForm({ ...form, amenities: [...form.amenities, amenityInput.trim()] });
                  setAmenityInput('');
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-semibold">Photo gallery</h3>
          <div className="space-y-2">
            {form.galleryImageUrls.map((url, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input flex-1 text-xs" readOnly={!isAdmin} value={url} onChange={(e) => {
                  const next = [...form.galleryImageUrls];
                  next[i] = e.target.value;
                  setForm({ ...form, galleryImageUrls: next });
                }} />
                {isAdmin && (
                  <>
                    <button className="btn-ghost !px-2 !py-1" disabled={i === 0} onClick={() => setForm({ ...form, galleryImageUrls: move(form.galleryImageUrls, i, i - 1) })}>
                      ↑
                    </button>
                    <button
                      className="btn-ghost !px-2 !py-1"
                      disabled={i === form.galleryImageUrls.length - 1}
                      onClick={() => setForm({ ...form, galleryImageUrls: move(form.galleryImageUrls, i, i + 1) })}
                    >
                      ↓
                    </button>
                    <button className="text-rose-500 hover:underline" onClick={() => setForm({ ...form, galleryImageUrls: form.galleryImageUrls.filter((_, j) => j !== i) })}>
                      remove
                    </button>
                  </>
                )}
              </div>
            ))}
            {form.galleryImageUrls.length === 0 && <p className="text-sm text-slate-500">No photos added yet.</p>}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <input className="input" placeholder="https://…" value={galleryInput} onChange={(e) => setGalleryInput(e.target.value)} />
              <button
                className="btn-ghost"
                disabled={!galleryInput.trim()}
                onClick={() => {
                  setForm({ ...form, galleryImageUrls: [...form.galleryImageUrls, galleryInput.trim()] });
                  setGalleryInput('');
                }}
              >
                Add photo
              </button>
            </div>
          )}
        </div>

        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Custom sections</h3>
            {isAdmin && (
              <button
                className="btn-ghost !py-1.5"
                onClick={() => setForm({ ...form, sections: [...form.sections, { id: newId(), heading: '', body: '' }] })}
              >
                + Add section
              </button>
            )}
          </div>
          {form.sections.map((s, i) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">Section {i + 1}</span>
                {isAdmin && (
                  <div className="flex gap-1.5">
                    <button className="btn-ghost !px-2 !py-1" disabled={i === 0} onClick={() => setForm({ ...form, sections: move(form.sections, i, i - 1) })}>
                      ↑
                    </button>
                    <button className="btn-ghost !px-2 !py-1" disabled={i === form.sections.length - 1} onClick={() => setForm({ ...form, sections: move(form.sections, i, i + 1) })}>
                      ↓
                    </button>
                    <button className="text-rose-500 hover:underline" onClick={() => setForm({ ...form, sections: form.sections.filter((x) => x.id !== s.id) })}>
                      remove
                    </button>
                  </div>
                )}
              </div>
              <input
                className="input mb-2"
                placeholder="Heading"
                disabled={!isAdmin}
                value={s.heading}
                onChange={(e) => setForm({ ...form, sections: form.sections.map((x) => (x.id === s.id ? { ...x, heading: e.target.value } : x)) })}
              />
              <textarea
                className="input"
                rows={3}
                placeholder="Body text"
                disabled={!isAdmin}
                value={s.body}
                onChange={(e) => setForm({ ...form, sections: form.sections.map((x) => (x.id === s.id ? { ...x, body: e.target.value } : x)) })}
              />
            </div>
          ))}
          {form.sections.length === 0 && <p className="text-sm text-slate-500">No custom sections yet.</p>}
        </div>

        {isAdmin && (
          <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? 'Saving…' : 'Save page'}
          </button>
        )}
      </div>

      <div className="lg:sticky lg:top-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Live preview</p>
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700" style={{ height: 600 }}>
          {code ? (
            <iframe key={previewKey} src={`/book/${code}`} title="Preview" className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a property</div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">Refreshes after you save.</p>
      </div>
    </div>
  );
}

// ── SEO ───────────────────────────────────────────────────────────────────────

interface Seo {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  ogImageUrl: string;
  published: boolean;
}

function SeoTab({ propertyId, code, isAdmin }: { propertyId: string; code: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['seo', propertyId],
    queryFn: () => api<{ seo: Seo }>(`/seo/${propertyId}`),
  });
  const [form, setForm] = useState<Seo | null>(null);
  useEffect(() => {
    if (data) setForm(data.seo);
  }, [data]);

  const save = useMutation({
    mutationFn: (v: Seo) => api(`/seo/${propertyId}`, { method: 'PUT', json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });

  if (isLoading || !form) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const publicUrl = `${location.origin}/book/${code}`;

  return (
    <div className="card max-w-xl space-y-3 p-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!isAdmin} checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          Published {!form.published && <span className="text-xs text-amber-500">(page returns 404 until published)</span>}
        </label>
        {form.published && (
          <a className="btn-ghost !py-1.5" href={publicUrl} target="_blank" rel="noreferrer">
            View ↗
          </a>
        )}
      </div>
      <div>
        <label className="label">Meta title</label>
        <input className="input" disabled={!isAdmin} value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} />
      </div>
      <div>
        <label className="label">Meta description</label>
        <textarea className="input" rows={2} disabled={!isAdmin} value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} />
      </div>
      <div>
        <label className="label">Keywords (comma-separated)</label>
        <input
          className="input"
          disabled={!isAdmin}
          value={form.keywords.join(', ')}
          onChange={(e) => setForm({ ...form, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })}
        />
      </div>
      <div>
        <label className="label">Social share image URL</label>
        <input className="input" disabled={!isAdmin} value={form.ogImageUrl} onChange={(e) => setForm({ ...form, ogImageUrl: e.target.value })} />
      </div>
      {isAdmin && (
        <button className="btn-primary w-full" onClick={() => save.mutate(form)} disabled={save.isPending}>
          Save
        </button>
      )}
    </div>
  );
}

// ── FAQs ──────────────────────────────────────────────────────────────────────

interface Faq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

function FaqsTab({ propertyId, isAdmin }: { propertyId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['seo', propertyId],
    queryFn: () => api<{ faqs: Faq[] }>(`/seo/${propertyId}`),
  });
  const addFaq = useMutation({
    mutationFn: (v: { question: string; answer: string }) => api(`/seo/${propertyId}/faqs`, { method: 'POST', json: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });
  const deleteFaq = useMutation({
    mutationFn: (id: string) => api(`/seo/faqs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo'] }),
  });
  const [q, setQ] = useState('');
  const [a, setA] = useState('');

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  return (
    <div className="max-w-xl">
      <h3 className="mb-2 text-sm font-semibold">FAQs (shown with FAQPage structured data)</h3>
      <div className="space-y-2">
        {data?.faqs.map((f) => (
          <div key={f.id} className="card p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{f.question}</p>
              {isAdmin && (
                <button className="text-xs text-rose-500 hover:underline" onClick={() => deleteFaq.mutate(f.id)}>
                  delete
                </button>
              )}
            </div>
            <p className="text-slate-500 dark:text-slate-400">{f.answer}</p>
          </div>
        ))}
        {data?.faqs.length === 0 && <p className="text-sm text-slate-500">No FAQs yet.</p>}
      </div>
      {isAdmin && (
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
      )}
    </div>
  );
}

// ── Link & embed ──────────────────────────────────────────────────────────────

function EmbedTab({ code, name }: { code: string; name: string }) {
  const publicUrl = `${location.origin}/book/${code}`;
  const widgetSnippet = `<div data-cm-booking-widget="${code}"></div>\n<script src="${location.origin}/api/public/widget.js" async></script>`;
  const iframeSnippet = `<iframe src="${publicUrl}" width="100%" height="900" style="border:0" loading="lazy" title="Book ${name}"></iframe>`;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card space-y-3 p-4">
        <label className="label">Direct link</label>
        <div className="flex gap-2">
          <input className="input flex-1" readOnly value={publicUrl} onFocus={(e) => e.target.select()} />
          <CopyButton text={publicUrl} />
        </div>
        <p className="text-xs text-slate-500">Share this anywhere — social bio, email signature, a QR code at the front desk. Never requires login.</p>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <label className="label mb-0">Widget embed (recommended)</label>
          <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">auto-sizing</span>
        </div>
        <div className="flex items-start gap-2">
          <textarea className="input flex-1 font-mono text-xs" rows={2} readOnly value={widgetSnippet} onFocus={(e) => e.target.select()} />
          <CopyButton text={widgetSnippet} />
        </div>
        <p className="text-xs text-slate-500">
          Paste this into your own site's HTML. It resizes itself to fit the content — no fixed height to guess, and it
          stays visually inline with your page instead of showing scrollbars.
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <label className="label">Raw iframe (manual size)</label>
        <div className="flex items-start gap-2">
          <textarea className="input flex-1 font-mono text-xs" rows={3} readOnly value={iframeSnippet} onFocus={(e) => e.target.select()} />
          <CopyButton text={iframeSnippet} />
        </div>
        <p className="text-xs text-slate-500">Simpler, but you set a fixed height yourself — use the widget embed above unless you need this specifically.</p>
      </div>
    </div>
  );
}
