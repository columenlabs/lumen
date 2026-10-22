import { LumenView } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { STORES, STORE_DOMAIN, storeView } from '../sample';

const meta = {
  title: 'Pages and views/LumenView',
  component: LumenView,
  parameters: {
    docs: {
      description: {
        component:
          'One view as a card: a table of the rows a page hands it, with sort, totals, grouping and a pivot. LumenLayout puts it on a page with its filter; use it alone for a second table.',
      },
    },
  },
  args: { domain: STORE_DOMAIN as never, config: storeView(), rows: STORES as never },
} satisfies Meta<typeof LumenView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Table: Story = {};

export const Grouped: Story = {
  args: { groupBy: STORE_DOMAIN.fields.find((f) => f.key === 'region') as never },
};

export const Pivot: Story = {
  args: {
    pivot: true,
    config: storeView({
      pivot: { rows: 'region', columns: 'format', value: 'revenue', agg: 'sum' },
    }),
  },
};
