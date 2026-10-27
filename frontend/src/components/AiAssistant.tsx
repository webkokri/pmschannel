import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useProperty } from '@/lib/property';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AiAssistant() {
  const { selectedId } = useProperty();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ configured: boolean }>('/ai/status') });

  const send = useMutation({
    mutationFn: (next: Message[]) => api<{ ok: boolean; reply: string }>('/ai/chat', { method: 'POST', json: { messages: next, propertyId: selectedId } }),
    onSuccess: (r) => setMessages((m) => [...m, { role: 'assistant', content: r.reply }]),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const next = [...messages, { role: 'user' as const, content: input.trim() }];
    setMessages(next);
    setInput('');
    send.mutate(next);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-xl text-white shadow-lg hover:bg-brand-500"
        title="AI Assistant"
      >
        ✦
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-end p-4 sm:items-center sm:p-6">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex h-[32rem] w-full max-w-sm flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <p className="font-semibold">AI Assistant</p>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {!status.data?.configured && (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                Not configured on this server (no ANTHROPIC_API_KEY) — messages will explain that.
              </p>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              {messages.length === 0 && (
                <p className="text-slate-400">
                  Ask about occupancy, recent bookings or open conflicts — I can only answer from current data, and I
                  can't take actions myself.
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                  <span
                    className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left ${
                      m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
                    }`}
                  >
                    {m.content}
                  </span>
                </div>
              ))}
              {send.isPending && <p className="text-slate-400">Thinking…</p>}
            </div>

            <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
              <input
                className="input"
                placeholder="Ask a question…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn-primary !px-3" disabled={send.isPending}>
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
