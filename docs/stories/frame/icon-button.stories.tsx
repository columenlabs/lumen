import { IconButton } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PinIcon, RefreshCwIcon } from 'lucide-react';
import { fn } from 'storybook/test';

const meta = {
  title: 'Frame/IconButton',
  component: IconButton,
  parameters: {
    docs: {
      description: {
        component:
          'Every icon button: the icon alone, its name in a tooltip and the accessible name. `busy` spins it, `pressed` fills it, `to` and `href` make it a link.',
      },
    },
  },
  args: { icon: RefreshCwIcon, label: 'Refresh', onClick: fn() },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const Busy: Story = { args: { busy: true } };
export const Pressed: Story = { args: { icon: PinIcon, label: 'Pinned', pressed: true } };
