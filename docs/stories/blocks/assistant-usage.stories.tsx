import type { UsageEntry, UsageHistory } from '@columenlabs/lumen-ui-types/assistant';
import { type AssistantAdapter, AssistantUsageTable } from '@columenlabs/lumen-ui/assistant';
import type { Meta, StoryObj } from '@storybook/react-vite';

const now = Date.now();
const entry = (
  id: string,
  title: string,
  ago: number,
  calls: number,
  usd: number,
  more: Partial<UsageEntry> = {},
): UsageEntry => ({
  id,
  kind: id.startsWith('chat:') ? 'chat' : 'task',
  title,
  first: now - ago - 60_000,
  at: now - ago,
  calls,
  in: calls * 16_000,
  read: calls * 9_000,
  out: calls * 140,
  usd,
  parts: [],
  ...more,
});

const history: UsageHistory = {
  month: new Date().toISOString().slice(0, 7),
  months: [],
  usd: 7.4,
  rows: [],
  entries: [
    entry(
      'chat:a',
      'Can you deepen these slots to 0.40 mm and make the whole bracket 5 mm longer and 2 mm wider, keeping the holes where they are?',
      20 * 60_000,
      12,
      0.41,
      { turns: 3, images: 2, refs: 2 },
    ),
    entry('chat:b', 'Close this hole', 3 * 3_600_000, 77, 6.29, { turns: 9, refs: 4 }),
    entry('chat:c', 'List two ways to fasten a lid to a printed box', 4 * 3_600_000, 5, 0.03, {
      turns: 1,
    }),
    entry('task:rebuild:1', 'Rebuild Bracket', 5 * 3_600_000, 2, 0.1, { task: 'rebuild' }),
    // A chat from before turns were counted.
    entry('chat:d', 'Rotate the lid and reset it to zero', 26 * 3_600_000, 13, 0.47),
  ],
};

const client = { key: 'usage-story', usage: async () => history } as unknown as AssistantAdapter;

const meta = {
  title: 'Blocks/Assistant/Usage',
  component: AssistantUsageTable,
  parameters: {
    docs: {
      description: {
        component:
          "Settings ▸ Assistant ▸ Usage: one row a chat or run this month. The Session column takes all the width the other columns leave (`maxWidth: 'fill'`). Turns counts the messages the person sent; a row's hover adds its tokens, attachments (images and picks) and cost. Runs, and chats from before turns were counted, show a dash.",
      },
    },
  },
  args: { client },
} satisfies Meta<typeof AssistantUsageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Usage: Story = {
  render: (a) => (
    <div className="max-w-[40rem]">
      <AssistantUsageTable {...a} />
    </div>
  ),
};
