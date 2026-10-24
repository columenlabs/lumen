import {
  type FilterField,
  type LumenLoad,
  LumenTokenizedFilter,
  LumenWidget,
  useLumenFilter,
} from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { STORES, STORE_DOMAIN, type Store } from '../sample';
import { width } from '../util';

const fields: FilterField<Store>[] = STORE_DOMAIN.fields
  .filter((f) => f.filterable)
  .map((f) => ({ key: f.key, label: f.label, icon: f.icon, values: (r) => [String(f.value(r))] }));

/** A made-up source: Refresh waits a moment, as a real reload does. */
const load: LumenLoad = {
  loading: false,
  fetching: false,
  refreshing: false,
  background: false,
  error: null,
  stale: null,
  refresh: () => new Promise((r) => setTimeout(r, 600)),
  tookMs: 120,
  cached: false,
  at: Date.now(),
};

function Demo({ header }: { header: boolean }) {
  const filter = useLumenFilter(STORES, fields, {
    text: (r) => [r.store],
    initial: [{ key: 'region', value: 'north' }],
  });
  const revenue = filter.results.reduce((s, r) => s + r.revenue, 0);
  return (
    <LumenWidget
      id="revenue"
      kind="metric"
      style="number"
      title="Revenue"
      shown={{ header, filter: true, refresh: true }}
      load={load}
      filter={<LumenTokenizedFilter filter={filter} />}
      filterCount={filter.tokens.length}
      link={false}
    >
      <p className="text-muted-foreground text-xs">Revenue</p>
      <p className="num font-semibold text-2xl">${revenue.toLocaleString()}</p>
      <p className="text-muted-foreground text-xs">
        {filter.results.length} of {STORES.length} stores
      </p>
    </LumenWidget>
  );
}

const meta = {
  title: 'Blocks/Editable widget',
  component: LumenWidget,
  decorators: [width(360)],
  parameters: {
    docs: {
      description: {
        component:
          'The frame every card sits in: header, link square, filter, ↻ and ⋯ menu. With Header off (Edit widget ▸ Controls) the card is its body alone, and a faint ⋯ in its corner keeps Ask, Refresh and Filter in reach; an active filter shows its count beside it.',
      },
    },
  },
  args: { id: 'revenue', kind: 'metric', title: 'Revenue', children: null },
} satisfies Meta<typeof LumenWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Header: Story = { render: () => <Demo header /> };
export const HeaderOff: Story = { render: () => <Demo header={false} /> };
