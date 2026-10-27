import { LumenShell, NavGroup, type SettingsSectionDef } from '@columenlabs/lumen-ui';
import type {
  AssistantChat,
  AssistantEvent,
  AssistantStatus,
  ChatItem,
  DraftItem,
  StepItem,
} from '@columenlabs/lumen-ui-types/assistant';
import {
  type AssistantAdapter,
  type AssistantSource,
  assistantAdminSections,
  assistantSettingsSections,
  composeAssistant,
  selectionRef,
  useLumenAssistantDock,
} from '@columenlabs/lumen-ui/assistant';
import { Button } from '@columenlabs/lumen-ui/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookOpenIcon, HomeIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const NOW = Date.UTC(2026, 9, 26, 17);
const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const NOTES = ['Launch plan', 'Q3 review', 'Hiring loop', 'Pricing ideas'];
const NOTES_SOURCE: AssistantSource = {
  id: 'notes',
  label: 'Notes',
  icon: BookOpenIcon,
  items: (q) =>
    NOTES.filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((n) => ({
      id: n,
      label: n,
      detail: 'Note',
      ref: { kind: 'note', label: n },
    })),
};

const STATUS: AssistantStatus = {
  name: 'Helper',
  commands: [
    { name: 'find', about: 'Find notes about something', args: '<words>' },
    { name: 'tidy', about: 'Tidy the open note' },
  ],
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
      provider: 'anthropic',
      effort: 'default',
    },
    {
      id: 'steady',
      label: 'Steady',
      about: 'Most work: reading, comparing, drafting',
      model: 'claude-sonnet-5-5',
      model_label: 'Claude Sonnet 5.5',
      provider: 'anthropic',
      effort: 'default',
    },
    {
      id: 'deep',
      label: 'Deep',
      about: 'Hard judgement across many results',
      model: 'gpt-6-astra',
      model_label: 'GPT-6 Astra',
      provider: 'openai',
      effort: 'high',
    },
  ],
  models: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', group: 'Claude', provider: 'anthropic' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', group: 'Claude', provider: 'anthropic' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', group: 'Claude', provider: 'anthropic' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', group: 'OpenAI', provider: 'openai' },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', group: 'OpenAI', provider: 'openai' },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', group: 'OpenAI', provider: 'openai' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', group: 'OpenAI', provider: 'openai' },
  ],
  tasks: [{ id: 'chat', label: 'Chat', about: 'The side panel', tier: 'fast' }],
  groups: [
    {
      id: 'notes',
      label: 'Notes',
      about: 'Read your notes, draft or make changes',
      access: 'draft',
      drafts: true,
      writes: true,
    },
    {
      id: 'contacts',
      label: 'Contacts',
      about: 'Read the people you work with',
      access: 'read',
      drafts: true,
      writes: false,
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
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic',
      prefix: 'sk-ant-',
      keys_url: 'https://console.anthropic.com/settings/keys',
      app: {
        set: true,
        hint: 'sk-ant-…7Qx2',
        saved_at: NOW - 5 * 86_400_000,
        test: { at: NOW - 3_600_000, ok: true, detail: 'Anthropic took the key.' },
      },
      own: { set: false },
    },
    {
      id: 'openai',
      label: 'OpenAI',
      prefix: 'sk-',
      keys_url: 'https://platform.openai.com/api-keys',
      signin: 'chatgpt',
      app: { set: false },
      own: { set: false },
    },
  ],
  caps: { app: 10, own: 10 },
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

const REMINDERS = [
  ['Remind Sam about the Q4 numbers', 'Friday'],
  ['Book the venue for the offsite', 'Monday'],
  ['Send the hiring loop feedback', 'Tuesday'],
  ['Review the pricing ideas with Lee', 'Wednesday'],
  ['Renew the design tool licence', 'Thursday'],
];

/** A chat with a change made at once (Undo) and five drafted cards in one stack. */
const MANY: AssistantChat = {
  id: 'c_2',
  title: 'Reminders for the week',
  at: NOW,
  items: [
    {
      kind: 'user',
      text: 'Rename the launch note, then draft a reminder for each open ask.',
      at: NOW - 90_000,
    },
    {
      kind: 'step',
      id: 'w1',
      tool: 'notes__note_rename',
      title: 'Rename a note',
      ok: true,
      ms: 240,
      write: { undo: true, status: 'done' },
    },
    { kind: 'text', text: 'I renamed the note to **Launch plan v2** and drafted five reminders.' },
    ...REMINDERS.map(
      ([title, due], i): DraftItem => ({
        kind: 'draft',
        id: `r${i}`,
        tool: 'notes__reminder_write',
        title: 'Add a reminder',
        args: { title, due, list: 'Work' },
        status: i === 0 ? 'saved' : 'open',
      }),
    ),
  ] as ChatItem[],
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

function mockAdapter(
  o: { status?: Partial<AssistantStatus>; chat?: AssistantChat } = {},
): AssistantAdapter {
  let status: AssistantStatus = { ...STATUS, ...o.status };
  const chat = structuredClone(o.chat ?? CHAT);
  const done = (patch: Partial<AssistantStatus>) => {
    status = { ...status, ...patch };
    return Promise.resolve(status);
  };
  const ok = { at: Date.now(), ok: true, detail: 'The key works.' };
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
    appCap: (cap) => done({ caps: { ...status.caps, app: cap } }),
    appKey: async (id, k) => {
      await wait(600);
      return done({
        providers: status.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                app: k
                  ? { set: true, hint: `${k.slice(0, 7)}…${k.slice(-4)}`, test: ok }
                  : { set: false },
              }
            : p,
        ),
      });
    },
    testAppKey: async () => {
      await wait(500);
      return ok;
    },
    ownKey: async (id, k) => {
      await wait(600);
      return done({
        providers: status.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                own: k
                  ? { set: true, hint: `${k.slice(0, 7)}…${k.slice(-4)}`, test: ok }
                  : { set: false },
              }
            : p,
        ),
      });
    },
    ownCap: (cap) => done({ caps: { ...status.caps, own: cap } }),
    testOwnKey: async () => {
      await wait(500);
      return ok;
    },
    startSignin: async () => ({
      url: 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client',
      redirect: 'http://127.0.0.1:1455/auth/callback',
    }),
    finishSignin: async (id) => {
      await wait(600);
      return done({
        providers: status.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                own: {
                  set: true,
                  via: 'chatgpt' as const,
                  hint: 'ada@example.com',
                  test: { ...ok, detail: 'ChatGPT plan sign-in works.' },
                },
              }
            : p,
        ),
      });
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
      { id: chat.id, title: chat.title, at: NOW },
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
    undoWrite: async (_c, id) => {
      await wait(400);
      const st = chat.items.find(
        (i): i is StepItem => i.kind === 'step' && i.id === id,
      ) as StepItem;
      st.write = { undo: true, status: 'undone' };
      return { ...st };
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
  chatId = 'c_1',
}: {
  adapter: AssistantAdapter;
  openChat: boolean;
  openPanel?: boolean;
  chatId?: string;
}) {
  const dock = useLumenAssistantDock(adapter, {
    name: 'Helper',
    context: { label: 'Home' },
    sources: [NOTES_SOURCE],
  });
  const [sections] = useState<SettingsSectionDef[]>(() =>
    // The admin's shared keys sit in the app's admin settings; the story lists them last.
    [
      ...assistantSettingsSections({ client: adapter, name: 'Helper' }),
      ...assistantAdminSections({ client: adapter }),
    ],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: open the story's chat once on mount
  useEffect(() => {
    dock.setOpen(openPanel);
    if (openChat) void dock.chat.open(chatId);
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
      <div className="flex flex-col gap-3 p-6 text-sm">
        <p className="text-muted-foreground">The app's page sits here.</p>
        {/* Marked sections: `#` lists them under On this page, and Point at… picks them. */}
        <section
          data-assistant-section="Goals"
          data-assistant-kind="plan section"
          data-assistant-id="goals"
          className="max-w-prose"
        >
          <h3 className="font-medium">Goals</h3>
          <p data-assistant-where="Launch plan ▸ Goals">
            Ship the beta to forty teams by March, then open sign-ups once support can answer within
            a day.
          </p>
        </section>
        <section
          data-assistant-section="Risks"
          data-assistant-kind="plan section"
          data-assistant-id="risks"
          className="max-w-prose"
        >
          <h3 className="font-medium">Risks</h3>
          <p>Support may not keep up with forty teams at once.</p>
        </section>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            composeAssistant({
              refs: [
                selectionRef({
                  text: 'Ship the beta to forty teams by March',
                  where: 'Launch plan ▸ Goals',
                }),
              ],
              text: '',
            })
          }
        >
          Ask Helper about the goal
        </Button>
      </div>
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

/** Many cards: drafts in a row stack into one list with Save all; a change made at once has Undo. */
export const ManyCards: StoryObj = {
  render: () => {
    const [adapter] = useState(() => mockAdapter({ chat: MANY }));
    return <Docked adapter={adapter} openChat chatId="c_2" />;
  },
};

/** No key yet: the panel says what to do and links to Settings. */
export const NotConnected: StoryObj = {
  render: () => {
    const [adapter] = useState(() =>
      mockAdapter({
        status: {
          wait: 'not_connected',
          wait_provider: 'anthropic',
          providers: STATUS.providers.map((p) => ({ ...p, app: { set: false } })),
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
