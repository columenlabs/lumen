import { LumenView } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { STORES, STORE_DOMAIN, storeView } from '../sample';

const meta = {
  title: 'Components/Pages and views/LumenView',
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

/** The page footer (`pagination.footer`) under a server's pages: 3,243 rows, 20 a page. */
export const PageFooter: Story = {
  args: { config: storeView({ pagination: { on: true, size: 25, footer: true } }) },
  render: function Render(args) {
    const [page, setPage] = useState(3);
    return (
      <LumenView {...args} paging={{ page, size: 20, total: 3243, more: false, onPage: setPage }} />
    );
  },
};
