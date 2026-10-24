import { ColorChip, ColorDot } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Feedback/ColorDot',
  component: ColorDot,
  subcomponents: { ColorChip },
  parameters: {
    docs: {
      description: {
        component:
          'A small dot in any CSS colour (a theme token reads in both themes); `ColorChip` puts one before a label.',
      },
    },
  },
  args: { color: 'var(--chart-2)' },
} satisfies Meta<typeof ColorDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dot: Story = {};
export const Chips: Story = {
  render: () => (
    <div className="flex gap-2">
      <ColorChip color="var(--chart-1)">Travel</ColorChip>
      <ColorChip color="var(--chart-3)">Work</ColorChip>
      <ColorChip color="var(--chart-5)">Home</ColorChip>
    </div>
  ),
};
