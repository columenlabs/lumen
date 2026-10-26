// What the assistant's panel and Settings call: an adapter an app fills, or `assistantClient(url)`
// over the routes of `@columenlabs/lumen-ai/assistant` (`assistantRoutes`).
import type {
  AssistantChat,
  AssistantChatRow,
  AssistantEvent,
  AssistantMessage,
  AssistantSettingsPatch,
  AssistantStatus,
  DraftItem,
  KeyState,
} from '@columenlabs/lumen-ui-types/assistant';
import { ApiError, apiJson } from '../api-fetch';

type Test = NonNullable<KeyState['test']>;

export interface AssistantAdapter {
  /** Names the cache its reads keep (two assistants on one page need two keys). */
  key: string;
  status(): Promise<AssistantStatus>;
  settings(patch: AssistantSettingsPatch): Promise<AssistantStatus>;
  /** Admin: what each person may spend a month on the app's key. */
  appCap(usd: number): Promise<AssistantStatus>;
  /** Admin: the app's Claude key (tested before it is kept); null removes it. */
  appKey(key: string | null): Promise<AssistantStatus>;
  testAppKey(): Promise<Test>;
  /** The person's own key and its monthly cap; null removes it. */
  ownKey(key: string | null, cap?: number): Promise<AssistantStatus>;
  ownCap(usd: number): Promise<AssistantStatus>;
  testOwnKey(): Promise<Test>;
  /** Admin: ScrapeQL's Access service token; null removes it. */
  scrapeql(token: { client_id: string; client_secret: string } | null): Promise<AssistantStatus>;
  testScrapeql(): Promise<Test>;
  chats(): Promise<AssistantChatRow[]>;
  chat(id: string): Promise<AssistantChat>;
  removeChat(id: string): Promise<void>;
  /** One answer: `onEvent` hears each event as it streams; abort `signal` to stop it. */
  send(
    msg: AssistantMessage,
    onEvent: (e: AssistantEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  settleDraft(chatId: string, draftId: string, action: 'save' | 'dismiss'): Promise<DraftItem>;
}

/** Reads `event:` / `data:` blocks off a server-sent event stream. */
async function readEvents(body: ReadableStream<Uint8Array>, on: (e: AssistantEvent) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let at = buf.indexOf('\n\n');
    while (at >= 0) {
      const block = buf.slice(0, at);
      buf = buf.slice(at + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        try {
          on({ event, data: JSON.parse(data) } as AssistantEvent);
        } catch {}
      }
      at = buf.indexOf('\n\n');
    }
  }
}

/** The adapter over `assistantRoutes` mounted at `base` (`/api/assistant`). */
export function assistantClient(base: string): AssistantAdapter {
  const root = base.replace(/\/+$/, '');
  const get = <T>(path: string) => apiJson<T>(`${root}${path}`, {}, 'assistant');
  const send = <T>(method: string, path: string, body: unknown = {}) =>
    apiJson<T>(`${root}${path}`, { method, body: JSON.stringify(body) }, 'assistant');
  return {
    key: `assistant:${root}`,
    status: () => get('/status'),
    settings: (patch) => send('PUT', '/settings', patch),
    appCap: (usd) => send('PUT', '/app', { cap_usd: usd }),
    appKey: (key) => (key ? send('PUT', '/key', { api_key: key }) : send('DELETE', '/key')),
    testAppKey: () => send('POST', '/key/test'),
    ownKey: (key, cap) =>
      key
        ? send('PUT', '/my-key', { api_key: key, ...(cap === undefined ? {} : { cap_usd: cap }) })
        : send('DELETE', '/my-key'),
    ownCap: (usd) => send('PUT', '/my-key/cap', { cap_usd: usd }),
    testOwnKey: () => send('POST', '/my-key/test'),
    scrapeql: (token) =>
      token ? send('PUT', '/web/scrapeql', token) : send('DELETE', '/web/scrapeql'),
    testScrapeql: () => send('POST', '/web/test'),
    chats: () => get('/chats'),
    chat: (id) => get(`/chats/${encodeURIComponent(id)}`),
    removeChat: async (id) => {
      await send('DELETE', `/chats/${encodeURIComponent(id)}`);
    },
    settleDraft: (chatId, draftId, action) =>
      send('POST', `/chats/${encodeURIComponent(chatId)}/drafts/${encodeURIComponent(draftId)}`, {
        action,
      }),
    async send(msg, onEvent, signal) {
      const url = `${root}/chat`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(msg),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok || !res.body) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new ApiError(
          b.error ?? `The answer failed (${res.status})`,
          'POST',
          url,
          res.status,
          b.code,
        );
      }
      await readEvents(res.body, onEvent);
    },
  };
}
