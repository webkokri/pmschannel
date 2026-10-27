/**
 * Thin Claude API wrapper for the AI assistant + pricing/occupancy suggestions. Inert
 * ("AI not configured") until `ANTHROPIC_API_KEY` is set, same pattern as `lib/stripe.ts`.
 *
 * MVP scope: the assistant is answer-only over a data *snapshot* the caller assembles
 * (recent bookings, occupancy, open conflicts — see `modules/ai.ts`), not a live tool-use
 * loop against the database. That keeps the integration simple and safe — there is no
 * path from a chat message to a mutating database call; any action it suggests, staff
 * confirm through the normal UI. A real tool-use loop (Claude calling read/write
 * functions directly) is a natural next step once this is in real use.
 */
import { env } from '../../env';
import { logger } from './../logger';

const log = logger('ai:claude');

export const aiConfigured = Boolean(env.anthropicApiKey);

/** Default model — see Anthropic's model list for current recommended IDs. */
export const CLAUDE_MODEL = 'claude-sonnet-5';

async function client() {
  if (!env.anthropicApiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: env.anthropicApiKey });
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  ok: boolean;
  text: string;
}

/** One-shot (or short multi-turn) chat completion. */
export async function chat(messages: ChatMessage[], system: string): Promise<AiResult> {
  const anthropic = await client();
  if (!anthropic) {
    return { ok: false, text: 'The AI assistant is not configured on this server yet (no ANTHROPIC_API_KEY).' };
  }
  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { ok: true, text: text || '(Claude returned an empty response)' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('chat failed', err);
    return { ok: false, text: `AI request failed: ${message}` };
  }
}

/** Ask for strict JSON back (an array of suggestion objects) and parse it defensively. */
export async function chatJson<T>(prompt: string, system: string): Promise<T | null> {
  const result = await chat([{ role: 'user', content: prompt }], `${system}\n\nRespond with ONLY valid JSON, no prose, no markdown fences.`);
  if (!result.ok) return null;
  try {
    const cleaned = result.text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    log.warn('chatJson: failed to parse model output as JSON', { text: result.text, err });
    return null;
  }
}
