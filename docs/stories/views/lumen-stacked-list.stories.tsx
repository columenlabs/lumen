import {
  ColorChip,
  LumenStackedList,
  LumenStackedRow,
  RenameField,
  type StackedColumn,
  ToneDot,
} from '@columenlabs/lumen-ui';
import { Badge } from '@columenlabs/lumen-ui/ui/badge';
import { Spinner } from '@columenlabs/lumen-ui/ui/spinner';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const meta = {
  title: 'Components/Pages and views/LumenStackedList',
  component: LumenStackedList,
  subcomponents: { LumenStackedRow },
  parameters: {
    docs: {
      description: {
        component:
          'Rows that nest and fold, with columns that line up at every level: a source, the groups inside it, the items inside those. Each row is one line, a name over an optional meta line. A row with children or a `notice` starts folded; its notice shows only while it is open. `actions` show on hover or focus only. On a phone the columns marked `phone` stack at the row’s end.',
      },
    },
  },
} satisfies Meta<typeof LumenStackedList>;

export default meta;
type Story = StoryObj<typeof meta>;

const columns: StackedColumn[] = [
  { key: 'status', label: 'Status', width: '9rem', phone: true },
  { key: 'amount', label: 'Balance', width: '8rem', align: 'end', phone: true },
];

function Status({ tone, children }: { tone: 'ok' | 'warn' | 'idle'; children: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      {tone === 'idle' ? <Spinner className="size-3" /> : <ToneDot tone={tone} />}
      {children}
    </Badge>
  );
}

const num = (s: string) => <span className="num tabular-nums">{s}</span>;

function Item({ name, mask, amount }: { name: string; mask: string; amount: string }) {
  const [own, setOwn] = useState<string | null>(null);
  return (
    <LumenStackedRow
      name={own ?? name}
      title={
        <RenameField
          value={own ?? name}
          original={name}
          originLabel="At the source"
          onSave={setOwn}
        />
      }
      adornments={<span className="text-muted-foreground">••{mask}</span>}
      cells={{ amount: num(amount) }}
    />
  );
}

/** A source holds groups, groups hold items; folded until opened. */
export const Nested: Story = {
  args: { columns, children: null },
  render: () => (
    <LumenStackedList columns={columns} lead="Source" aria-label="Sources">
      <LumenStackedRow
        name="North Bank"
        adornments={<ColorChip color="var(--chart-1)">Direct</ColorChip>}
        meta="3 items · updated 4 min ago"
        cells={{ status: <Status tone="ok">Up to date</Status>, amount: num('$14,702.11') }}
      >
        <Item name="Everyday" mask="1001" amount="$978.56" />
        <Item name="Savings" mask="2040" amount="$13,723.55" />
      </LumenStackedRow>
      <LumenStackedRow
        name="feed.example.org"
        adornments={<ColorChip color="var(--chart-4)">Feed</ColorChip>}
        meta="3 groups · 6 items · 1 needs you"
        defaultOpen
        cells={{ status: <Status tone="warn">Needs you</Status>, amount: num('$22,410.90') }}
      >
        <LumenStackedRow
          name="River Credit Union"
          meta="Sign-in broke at the source"
          notice={
            <p className="text-sm text-warning">
              The source can’t reach this group. Sign in again where the feed is kept.
            </p>
          }
          cells={{ status: <Status tone="warn">Needs you</Status>, amount: num('$9,120.55') }}
        >
          <Item name="Checking" mask="3310" amount="$9,120.55" />
        </LumenStackedRow>
        <LumenStackedRow
          name="Harbor Card"
          meta="2 items"
          cells={{ status: <Status tone="ok">Synced</Status>, amount: num('−$1,804.22') }}
        >
          <Item name="Rewards card" mask="7781" amount="−$1,804.22" />
        </LumenStackedRow>
        <LumenStackedRow
          name="Summit Invest"
          meta="Reading history · 4 of 9"
          cells={{ status: <Status tone="idle">Loading</Status>, amount: num('$15,094.57') }}
        />
      </LumenStackedRow>
    </LumenStackedList>
  ),
};
