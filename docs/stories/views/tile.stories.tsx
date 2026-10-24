import { Tile, TileRow } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Pages and views/Tile',
  component: Tile,
  subcomponents: { TileRow },
  parameters: {
    docs: {
      description: {
        component:
          'One headline number with its label and up to a few lines under it. `TileRow` lays tiles in a row that wraps on phones.',
      },
    },
  },
  args: { label: 'Revenue', value: '$1,257,027', caption: 'this month' },
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = {};

export const Row: Story = {
  render: () => (
    <TileRow>
      <Tile label="Revenue" value="$1,257,027" caption="this month" />
      <Tile label="Orders" value="18,097" lines={['+4.1% on last month']} />
      <Tile label="Growth" value={<span className="text-gain">+1.29%</span>} />
    </TileRow>
  ),
};
