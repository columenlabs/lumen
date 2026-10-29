import { type BoardItem, ColorChip, LumenBoard } from '@columenlabs/lumen-ui';
import { Checkbox } from '@columenlabs/lumen-ui/ui/checkbox';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

/** A plan: 12 checkpoints holding 75 tasks. */
const columns = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i + 1}`,
  label: `Checkpoint ${i + 1}${i === 2 ? ': ship the first version to the pilot group' : ''}`,
}));

type Task = BoardItem & { done: boolean };

const items: Task[] = Array.from({ length: 75 }, (_, i) => ({
  id: `t${i}`,
  column: `c${(i % 11) + 1}`,
  title:
    i % 7 === 0
      ? `Write up what the interviews said about onboarding and share it ${i}`
      : `Task ${i + 1}`,
  meta: `Oct ${(i % 28) + 1}`,
  badges: i % 5 === 0 ? <ColorChip color="var(--chart-3)">Review</ColorChip> : undefined,
  done: i % 4 === 0,
}));

const meta = {
  title: 'Components/Pages and views/LumenBoard',
  component: LumenBoard,
  parameters: {
    docs: {
      description: {
        component:
          'Items in columns by stage. Each column scrolls on its own and the board scrolls sideways inside its box, never the page. On a narrow box the columns snap one a screen with a picker to jump. Cards are one line; `tick` is an optional slot before the title, and `onMove` adds a keyboard-friendly Move to menu.',
      },
    },
  },
  args: { columns, items, maxHeight: '28rem' },
} satisfies Meta<typeof LumenBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plan: Story = {
  render: function Render(args) {
    const [rows, setRows] = useState<Task[]>(items);
    return (
      <LumenBoard
        {...args}
        items={rows}
        tick={(it) => (
          <Checkbox
            aria-label={`Done: ${it.title}`}
            checked={it.done}
            onCheckedChange={(v) =>
              setRows((r) => r.map((x) => (x.id === it.id ? { ...x, done: v === true } : x)))
            }
          />
        )}
        onMove={(it, to) =>
          setRows((r) => r.map((x) => (x.id === it.id ? { ...x, column: to } : x)))
        }
      />
    );
  },
};
