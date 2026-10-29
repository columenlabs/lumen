import { type CalendarEvent, LumenCalendar } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const categories = [
  { id: 'talk', label: 'Talks', color: 'var(--chart-1)' },
  { id: 'workshop', label: 'Workshops', color: 'var(--chart-2)' },
  { id: 'office', label: 'Office hours', color: 'var(--chart-3)' },
  { id: 'social', label: 'Socials', color: 'var(--chart-5)' },
  { id: 'deadline', label: 'Deadlines', color: 'var(--chart-10)' },
];

const names = [
  'Kickoff and goals',
  'Planning a quarter that holds',
  'Hiring loop review',
  'Budget walk-through',
  'Design critique',
  'Roadmap open session',
  'Metrics that matter',
  'Coffee chat',
  'Architecture deep dive with the platform group',
  'Submit the written reflection',
];

/** 192 made-up events over three months, in five categories. */
const events: CalendarEvent[] = Array.from({ length: 192 }, (_, i) => {
  const cat = categories[i % categories.length]?.id ?? 'talk';
  const day = Date.UTC(2026, 8, 1) + Math.floor((i * 91) / 192) * 86_400_000;
  const hour = 8 + ((i * 7) % 10);
  const start = new Date(day + hour * 3_600_000 + (i % 2) * 1_800_000);
  if (cat === 'deadline')
    return {
      id: `e${i}`,
      title: names[9] ?? '',
      start: start.toISOString().slice(0, 10),
      category: cat,
    };
  return {
    id: `e${i}`,
    title: names[i % 9] ?? '',
    start,
    end: new Date(start.getTime() + (1 + (i % 3)) * 1_800_000),
    category: cat,
  };
});

const meta = {
  title: 'Components/Pages and views/LumenCalendar',
  component: LumenCalendar,
  parameters: {
    docs: {
      description: {
        component:
          'An events calendar over plain data: Month, Week (with a time axis) and Agenda, switched with tabs. Category chips filter, Today, previous and next are icon buttons, and a click on an event calls `onSelect` so the app opens its drawer. On a narrow box Month shows dots and the picked day’s list, and Agenda is the default. Every day and time is shown in `timeZone`.',
      },
    },
  },
  args: {
    events,
    categories,
    defaultDate: new Date('2026-10-15T12:00:00Z'),
    timeZone: 'America/New_York',
  },
} satisfies Meta<typeof LumenCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Program: Story = {
  render: function Render(args) {
    const [picked, setPicked] = useState<CalendarEvent | null>(null);
    return (
      <div className="flex flex-col gap-2">
        <LumenCalendar {...args} onSelect={setPicked} />
        <p className="truncate text-xs text-muted-foreground">
          {picked ? `Opened: ${picked.title}` : 'Click an event to open it'}
        </p>
      </div>
    );
  },
};

export const Week: Story = { args: { defaultView: 'week' } };

export const Agenda: Story = { args: { defaultView: 'agenda' } };

/** A task plan: whole-day due dates, one category each. */
export const Tasks: Story = {
  args: {
    categories: [
      { id: 'todo', label: 'To do', color: 'var(--chart-8)' },
      { id: 'done', label: 'Done', color: 'var(--chart-2)' },
    ],
    events: Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i + 1}: read chapter ${(i % 12) + 1}`,
      start: new Date(Date.UTC(2026, 9, 1 + ((i * 3) % 31))).toISOString().slice(0, 10),
      category: i % 3 ? 'todo' : 'done',
    })),
  },
};
