import { LumenShell, NavGroup, type SettingsSectionDef } from '@columenlabs/lumen-ui';
import type {
  AssistantChat,
  AssistantEvent,
  AssistantStatus,
  ChatItem,
  DraftItem,
} from '@columenlabs/lumen-ui-types/assistant';
import {
  type AssistantAdapter,
  assistantSettingsSections,
  useLumenAssistantDock,
} from '@columenlabs/lumen-ui/assistant';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookOpenIcon, HomeIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const NOW = Date.UTC(2026, 9, 26, 17);
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const STATUS: AssistantStatus = {
  name: 'Helper',
  wait: null,
  admin: true,
  tier: 'fast',
  tiers: [
    {
      id: 'fast',
      label: 'Fast',
      about: 'Quick lookups and short answers',
      model: 'claude-haiku-5-5',
      model_label: 'Claude Haiku 5.5',
      effort: 'default',
    },
    {
      id: 'steady',
      label: 'Steady',
      about: 'Most work: reading, comparing, drafting',
      model: 'claude-sonnet-5-5',
      model_label: 'Claude Sonnet 5.5',
      effort: 'default',
    },
    {
      id: 'deep',
      label: 'Deep',
      about: 'Hard judgement across many results',
      model: 'claude-opus-5-5',
      model_label: 'Claude Opus 5.5',
      effort: 'high',
    },
  ],
  models: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', group: 'Claude' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', group: 'Claude' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', group: 'Claude' },
  ],
  tasks: [{ id: 'chat', label: 'Chat', about: 'The side panel', tier: 'fast' }],
  groups: [
    {
      id: 'notes',
      label: 'Notes',
      about: 'Read your notes and draft new ones',
      access: 'draft',
      drafts: true,
    },
    {
      id: 'contacts',
      label: 'Contacts',
      about: 'Read the people you work with',
      access: 'read',
      drafts: true,
    },
  ],
  hand_off: 'next',
  advice: 'off',
  web: {
    fetch: true,
    scrapeql: {
      set: true,
      hint: 'a1b2c3d…e9f0',
      saved_at: NOW - 86_400_000,
      test: { at: NOW - 3_600_000, ok: true, detail: 'ScrapeQL answered with 4 tools.' },
    },
  },
  keys: {
    app: {
      set: true,
      hint: 'sk-ant-…7Qx2',
      saved_at: NOW - 5 * 86_400_000,
      cap: 10,
      test: { at: NOW - 3_600_000, ok: true, detail: 'Claude took the key.' },
    },
    own: { set: false, cap: 10 },
  },
  pay: 'app',
  spend: {
    month: '2026-10',
    usd: 1.84,
    cap: 10,
    payer: 'app',
    rows: [
      {
        label: 'Fast · Claude Haiku 5.5',
        payer: 'app',
        calls: 41,
        in: 812_000,
        read: 610_000,
        out: 22_000,
        usd: 0.62,
      },
      {
        label: 'Steady · Claude Sonnet 5.5',
        payer: 'app',
        calls: 7,
        in: 160_000,
        read: 90_000,
        out: 18_000,
        usd: 1.22,
      },
    ],
  },
};

const DRAFT: DraftItem = {
  kind: 'draft',
  id: 'd_1',
  tool: 'notes__note_write',
  title: 'Save a note',
  args: { title: 'Follow up with Sam', body: 'Send the Q4 numbers by Friday', tags: ['work'] },
  status: 'open',
};

const CHAT: AssistantChat = {
  id: 'c_1',
  title: 'What did Sam ask for?',
  at: NOW,
  items: [
    {
      kind: 'user',
      text: 'What did Sam ask for this week? Make a note to follow up.',
      at: NOW - 60_000,
    },
    {
      kind: 'step',
      id: 's1',
      tool: 'notes__note_search',
      title: 'Search notes',
      ok: true,
      ms: 420,
      rows: 3,
    },
    {
      kind: 'step',
      id: 's2',
      tool: 'contacts__contact_read',
      title: 'Read a contact',
      ok: true,
      ms: 180,
    },
    {
      kind: 'text',
      text: 'Sam asked for **the Q4 numbers** on Tuesday and again on Thursday. I drafted a note to follow up; press Save to keep it.',
    },
    DRAFT,
  ] as ChatItem[],
  usage: {
    calls: 3,
    in: 18_400,
    read: 12_100,
    out: 640,
    usd: 0.004,
    context: 9_800,
    parts: [
      {
        label: 'Fast · Claude Haiku 5.5',
        calls: 3,
        in: 18_400,
        read: 12_100,
        out: 640,
        usd: 0.004,
      },
    ],
  },
};

/** An answer with a step, a hand off to Steady and the reply, streamed word by word. */
const SCRIPT: AssistantEvent[] = [
  { event: 'step_start', data: { id: 's9', tool: 'notes__note_search', title: 'Search notes' } },
  {
    event: 'step',
    data: {
      kind: 'step',
      id: 's9',
      tool: 'notes__note_search',
      title: 'Search notes',
      ok: true,
      ms: 380,
      rows: 12,
    },
  },
  {
    event: 'handoff',
    data: {
      kind: 'handoff',
      tier: 'steady',
      label: 'Steady · Claude Sonnet 5.5',
      task: 'Compare the 12 notes and say which asks are still open',
      why: 'judgement',
    },
  },
  {
    event: 'text',
    data: { delta: 'Two asks are still open: the Q4 numbers and the venue.', handoff: true },
  },
  { event: 'text_end', data: { handoff: true } },
  {
    event: 'handoff_done',
    data: {
      usage: {
        label: 'Steady · Claude Sonnet 5.5',
        calls: 2,
        in: 9000,
        read: 4000,
        out: 300,
        usd: 0.021,
      },
    },
  },
];

function mockAdapter(o: { status?: Partial<AssistantStatus> } = {}): AssistantAdapter {
  let status: AssistantStatus = { ...STATUS, ...o.status };
  const chat = structuredClone(CHAT);
  const done = (patch: Partial<AssistantStatus>) => {
    status = { ...status, ...patch };
    return Promise.resolve(status);
  };
  const ok = { at: Date.now(), ok: true, detail: 'Claude took the key.' };
  return {
    key: 'story',
    status: async () => status,
    settings: async (p) =>
      done({
        ...(p.tier ? { tier: p.tier } : {}),
        ...(p.hand_off ? { hand_off: p.hand_off } : {}),
        ...(p.advice ? { advice: p.advice } : {}),
        ...(p.pay ? { pay: p.pay } : {}),
        ...(p.web ? { web: { ...status.web, fetch: !!p.web.fetch } } : {}),
        ...(p.access
          ? { groups: status.groups.map((g) => ({ ...g, access: p.access?.[g.id] ?? g.access })) }
          : {}),
      }),
    appCap: (cap) => done({ keys: { ...status.keys, app: { ...status.keys.app, cap } } }),
    appKey: async (k) => {
      await wait(600);
      return done({
        keys: {
          ...status.keys,
          app: k
            ? {
                set: true,
                hint: `${k.slice(0, 7)}…${k.slice(-4)}`,
                cap: status.keys.app.cap,
                test: ok,
              }
            : { set: false, cap: status.keys.app.cap },
        },
      });
    },
    testAppKey: async () => {
      await wait(500);
      return ok;
    },
    ownKey: async (k) => {
      await wait(600);
      return done({
        keys: {
          ...status.keys,
          own: k
            ? { set: true, hint: `${k.slice(0, 7)}…${k.slice(-4)}`, cap: 10, test: ok }
            : { set: false, cap: 10 },
        },
      });
    },
    ownCap: (cap) => done({ keys: { ...status.keys, own: { ...status.keys.own, cap } } }),
    testOwnKey: async () => {
      await wait(500);
      return ok;
    },
    scrapeql: async (t) =>
      done({
        web: {
          ...status.web,
          scrapeql: t
            ? { set: true, hint: `${t.client_id.slice(0, 7)}…`, test: ok }
            : { set: false },
        },
      }),
    testScrapeql: async () => {
      await wait(500);
      return { ...ok, detail: 'ScrapeQL answered with 4 tools.' };
    },
    chats: async () => [
      { id: 'c_1', title: CHAT.title, at: NOW },
      { id: 'c_0', title: 'Plan the offsite', at: NOW - 2 * 86_400_000 },
    ],
    chat: async () => chat,
    removeChat: async () => undefined,
    settleDraft: async (_c, id, action) => {
      await wait(400);
      const d = chat.items.find(
        (i): i is DraftItem => i.kind === 'draft' && i.id === id,
      ) as DraftItem;
      d.status = action === 'save' ? 'saved' : 'dismissed';
      return { ...d };
    },
    async send(msg, on, signal) {
      on({ event: 'chat', data: { id: chat.id, title: chat.title } });
      for (const e of SCRIPT) {
        await wait(350);
        signal?.throwIfAborted();
        on(e);
      }
      for (const word of `I checked your ${msg.message.length > 40 ? 'notes' : 'notes again'}: the Q4 numbers and the venue are still open. Want me to draft a reminder for each?`.split(
        ' ',
      )) {
        await wait(40);
        signal?.throwIfAborted();
        on({ event: 'text', data: { delta: `${word} ` } });
      }
      on({ event: 'text_end', data: {} });
      on({
        event: 'done',
        data: {
          id: chat.id,
          usage: {
            ...(CHAT.usage as NonNullable<AssistantChat['usage']>),
            calls: 6,
            usd: 0.027,
            context: 21_000,
          },
        },
      });
    },
  };
}

const nav = (
  <NavGroup
    label="Sample app"
    items={[
      { title: 'Home', to: '/', icon: HomeIcon, exact: true },
      { title: 'Notes', to: '/notes', icon: BookOpenIcon },
    ]}
  />
);

function Docked({
  adapter,
  openChat,
  openPanel = true,
}: {
  adapter: AssistantAdapter;
  openChat: boolean;
  openPanel?: boolean;
}) {
  const dock = useLumenAssistantDock(adapter, { name: 'Helper', context: { label: 'Home' } });
  const [sections] = useState<SettingsSectionDef[]>(() =>
    assistantSettingsSections({ client: adapter, name: 'Helper' }),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: open the story's chat once on mount
  useEffect(() => {
    dock.setOpen(openPanel);
    if (openChat) void dock.chat.open('c_1');
  }, []);
  return (
    <LumenShell
      app="sample"
      appLabel="Sample app"
      brand={<span className="px-2 font-semibold">Sample app</span>}
      nav={nav}
      user={{ email: 'ada@example.com', name: 'Ada Lovelace' }}
      headerActions={dock.button}
      panel={dock.panel}
      shared={sections}
      sharedLabel="All apps"
    >
      <div className="p-6 text-muted-foreground text-sm">The app's page sits here.</div>
    </LumenShell>
  );
}

/**
 * An app's assistant: the chat panel docked in LumenShell and its Settings sections, over
 * `assistantClient('/api/assistant')` and the routes of `@columenlabs/lumen-ai/assistant`. The app
 * names the assistant and its tiers. These stories run on an in-memory adapter.
 */
const meta: Meta = {
  title: 'Blocks/Assistant',
  parameters: { layout: 'fullscreen' },
};
export default meta;

/** A chat with tool calls and a drafted note to Save or Dismiss. Send a message to watch an answer stream. */
export const Chat: StoryObj = {
  render: () => {
    const [adapter] = useState(() => mockAdapter());
    return <Docked adapter={adapter} openChat />;
  },
};

/** No key yet: the panel says what to do and links to Settings. */
export const NotConnected: StoryObj = {
  render: () => {
    const [adapter] = useState(() =>
      mockAdapter({
        status: {
          wait: 'not_connected',
          keys: { app: { set: false, cap: 10 }, own: { set: false, cap: 10 } },
        },
      }),
    );
    return <Docked adapter={adapter} openChat={false} />;
  },
};

/** The Settings sections: open Settings from the profile menu, then the assistant under All apps. */
export const Settings: StoryObj = {
  render: () => {
    const [adapter] = useState(() => mockAdapter());
    return <Docked adapter={adapter} openChat={false} openPanel={false} />;
  },
};
