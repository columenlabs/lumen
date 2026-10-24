import { LumenDateInput } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const weekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

function Demo(props: Partial<Parameters<typeof LumenDateInput>[0]>) {
  const [value, setValue] = useState('2026-10-19');
  return (
    <LumenDateInput
      value={value}
      onChange={setValue}
      max="2026-10-23"
      onToday={() => setValue('2026-10-23')}
      atToday={value === '2026-10-23'}
      {...props}
    />
  );
}

const meta = {
  title: 'Components/Pickers and panels/LumenDateInput',
  component: LumenDateInput,
  parameters: {
    docs: {
      description: {
        component:
          'A date field with ‹ › to step one day back or forward (Alt+← and Alt+→ while it has focus). Pass `isOpen` to step only over open days, such as a trading calendar, and `unit` to name them in the tooltips. A step past `min` or `max` is off. `onToday` adds a Today icon button.',
      },
    },
  },
  args: { value: '2026-10-19', onChange: () => {} },
  render: (args) => <Demo size={args.size} unit={args.unit} />,
} satisfies Meta<typeof LumenDateInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryDay: Story = {};
export const TradingDays: Story = {
  render: () => <Demo isOpen={weekday} unit="trading day" />,
};
