import { StackedColumns } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const rows = Array.from({ length: 14 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 9, 9 + i)).toISOString().slice(0, 10);
  return { date, ok: 20 + ((i * 7) % 13), failed: i % 4 === 0 ? 3 : i % 5 === 0 ? 1 : 0 };
});

const meta = {
  title: 'Charts/StackedColumns',
  component: StackedColumns,
  parameters: {
    docs: {
      description: {
        component:
          'Columns over time, oldest on the left, each split into stacked parts (what worked and what failed per day). The highest part with a value gets the rounded cap; the tooltip lists each part and the total.',
      },
    },
  },
  args: {
    rows,
    x: 'date',
    label: 'Requests per day, last 14 days',
    tick: (d: string) => d.slice(5),
    parts: [
      { key: 'ok', name: 'Worked', fill: 'var(--gain)' },
      { key: 'failed', name: 'Failed', fill: 'var(--loss)' },
    ],
  },
} satisfies Meta<typeof StackedColumns>;

export default meta;
export const PerDay: StoryObj<typeof meta> = {};
