import { LumenSelector } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';

const cadences = [
  { value: 'daily', label: 'Daily', group: 'Often' },
  { value: 'weekly', label: 'Weekly', group: 'Often' },
  { value: 'monthly', label: 'Monthly', group: 'Now and then', detail: '1st' },
  { value: 'yearly', label: 'Yearly', group: 'Now and then', detail: 'Jan 1' },
];

const meta = {
  title: 'Components/Pickers and panels/LumenSelector',
  component: LumenSelector,
  parameters: {
    docs: {
      description: {
        component:
          'Every picker in one part: one value or many, groups, search past 8 options, and an Add row that turns typed text into a new value. On a phone the list opens as a bottom sheet.',
      },
    },
  },
  args: { options: cadences, value: 'weekly', label: 'Cadence', onChange: () => {} },
  render: function Render(args) {
    const [, update] = useArgs();
    return (
      <div className="w-64">
        <LumenSelector {...args} onChange={(value: unknown) => update({ value })} />
      </div>
    );
  },
} satisfies Meta<typeof LumenSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};

export const Many: Story = {
  args: { multiple: true, value: ['daily', 'weekly'], max: 3 } as never,
};

export const Chip: Story = { args: { trigger: 'chip' } };

export const AddNew: Story = {
  name: 'Add new values',
  args: { search: true, create: (q: string) => (q.trim() ? q.trim().toLowerCase() : null) },
};

const cities = [
  'Amsterdam',
  'Berlin',
  'Copenhagen',
  'Dublin',
  'Edinburgh',
  'Florence',
  'Geneva',
  'Helsinki',
  'Istanbul',
  'Krakow',
  'Lisbon',
  'Madrid',
  'Naples',
  'Oslo',
  'Prague',
  'Vienna',
].map((c) => ({ value: c.toLowerCase(), label: c }));

/** A long list: on a phone the sheet stops short of the top, and its X, a tap above it, a swipe
 *  down on its handle, Esc or back close it. */
export const LongList: Story = {
  args: { options: cities, value: 'lisbon', label: 'City' },
};
