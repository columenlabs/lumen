import { LumenConfirm } from '@columenlabs/lumen-ui';
import { Button } from '@columenlabs/lumen-ui/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Trash2Icon } from 'lucide-react';
import { fn } from 'storybook/test';

const meta = {
  title: 'Pickers and panels/LumenConfirm',
  component: LumenConfirm,
  parameters: {
    docs: {
      description: {
        component:
          'Asks before an action that cannot be undone. Wrap the button that opens it, or control `open` yourself. Destructive by default (a red action); `destructive={false}` for a plain confirm.',
      },
    },
  },
  args: {
    title: 'Delete view Stores?',
    onConfirm: fn(),
    children: (
      <Button variant="outline">
        <Trash2Icon />
        Delete
      </Button>
    ),
  },
} satisfies Meta<typeof LumenConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {};
export const Plain: Story = {
  args: {
    title: 'Publish a new version?',
    description: 'Everyone sees it on their next visit.',
    action: 'Publish',
    destructive: false,
    children: <Button>Publish</Button>,
  },
};
