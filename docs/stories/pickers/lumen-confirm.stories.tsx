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
          'Asks before an action that cannot be undone. Wrap the button that opens it, or control `open` yourself. Destructive by default (a red action); `destructive={false}` for a plain confirm. When `onConfirm` returns a promise the dialog stays open and busy until it settles: a failure shows in the dialog (`problem` words it), a success closes it or shows `done`.',
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
export const Waits: Story = {
  args: {
    title: 'Delete your account?',
    description: 'Your data and sign-in are deleted. It cannot be undone.',
    action: 'Delete account',
    busyAction: 'Deleting…',
    typeToConfirm: 'DELETE',
    size: 'default',
    onConfirm: fn(() => new Promise((resolve) => setTimeout(resolve, 1500))),
    done: { title: 'Your account is deleted', description: 'You are signed out.' },
    children: (
      <Button variant="destructive">
        <Trash2Icon />
        Delete account
      </Button>
    ),
  },
};
export const Fails: Story = {
  args: {
    ...Waits.args,
    onConfirm: fn(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('delete_failed')), 1200)),
    ),
    problem: () => "The server didn't answer, so nothing was deleted. Try again in a minute.",
  },
};
