import { DetailsTable, FactsTable } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Pages and views/DetailsTable',
  component: DetailsTable,
  subcomponents: { FactsTable },
  parameters: {
    docs: {
      description: {
        component:
          'A small fixed table for a drawer or card: a header, rows of cells and an optional total row. `FactsTable` lists label and value pairs.',
      },
    },
  },
  args: {
    head: [{ label: 'Store' }, { label: 'Orders', right: true }, { label: 'Revenue', right: true }],
    rows: [
      { key: 'a', cells: ['Lisbon', '1,701', '$174,155'] },
      { key: 'b', cells: ['Porto', '1,433', '$54,977'] },
      { key: 'c', cells: ['Faro', '659', '$49,175'] },
    ],
    foot: ['Total', '3,793', '$278,307'],
  },
} satisfies Meta<typeof DetailsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Details: Story = {};

export const Facts: Story = {
  render: () => (
    <FactsTable
      items={[
        ['Region', 'South'],
        ['Format', 'Flagship'],
        ['Opened', 'Jan 1, 2014'],
      ]}
    />
  ),
};
