import { LumenLayout, useLumenLoad } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SampleShell } from '../frame';
import { STORES, STORE_DOMAIN, storeView } from '../sample';

function StoresPage({ cards }: { cards?: unknown[] }) {
  const query = useQuery({ queryKey: ['stores'], queryFn: async () => STORES });
  const load = useLumenLoad(query);
  const [config, setConfig] = useState(() => storeView(cards ? { cards } : {}));
  return (
    <LumenLayout
      crumbs={[{ label: 'Stores' }]}
      domain={STORE_DOMAIN}
      config={config}
      rows={query.data ?? []}
      load={load}
      onConfigChange={setConfig}
      rowTitle={(r) => r.store}
    />
  );
}

const meta = {
  title: 'Blocks/Page layout',
  component: LumenLayout,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A page of cards from one saved view: its filter, a grid of widgets and its table. Give it a domain (the fields), a view config and the rows; it filters, groups, totals and lays out on the client. With `onConfigChange` the page offers Edit layout and + Widget.',
      },
    },
  },
  decorators: [
    (Story) => (
      <SampleShell>
        <Story />
      </SampleShell>
    ),
  ],
  args: { crumbs: [{ label: 'Stores' }] },
  render: () => <StoresPage />,
} satisfies Meta<typeof LumenLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TableOnly: Story = { name: 'Table' };

export const WithWidgets: Story = {
  name: 'Table and widgets',
  render: () => (
    <StoresPage
      cards={[
        {
          id: 'summary',
          kind: 'metric',
          style: 'row',
          w: 6,
          tiles: [
            { key: 'rev', label: 'Revenue', field: 'revenue', agg: 'sum' },
            { key: 'ord', label: 'Orders', field: 'orders', agg: 'sum' },
            { key: 'gro', label: 'Growth', field: 'growth', agg: 'mean', sign: true },
          ],
        },
        {
          id: 'by_region',
          kind: 'allocation',
          style: 'donut',
          by: 'region',
          value: 'revenue',
          w: 3,
        },
        {
          id: 'by_format',
          kind: 'allocation',
          style: 'bar_list',
          by: 'format',
          value: 'revenue',
          w: 3,
        },
        { id: 'view', kind: 'table', style: 'table' },
      ]}
    />
  ),
};
