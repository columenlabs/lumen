import { TimeLines } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const rows = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10);
  return { date, visits: 120 + ((i * 37) % 90), joins: 2 + ((i * 5) % 7), accounts: i % 3 };
});

const meta = {
  title: 'Components/Charts/TimeLines',
  component: TimeLines,
  parameters: {
    docs: {
      description: {
        component:
          'Lines over time, oldest on the left. A line with `right` reads off a second axis, for a count far smaller than the others; a null leaves a gap.',
      },
    },
  },
  args: {
    rows,
    x: 'date',
    label: 'Visits, sign-ups and new accounts per day, last 30 days',
    tick: (d: string) => d.slice(5),
    lines: [
      { key: 'visits', name: 'Visits', fill: 'var(--chart-6)' },
      { key: 'joins', name: 'Sign-ups', fill: 'var(--primary)', right: true },
      { key: 'accounts', name: 'New accounts', fill: 'var(--chart-3)', right: true },
    ],
  },
} satisfies Meta<typeof TimeLines>;

export default meta;
export const PerDay: StoryObj<typeof meta> = {};
