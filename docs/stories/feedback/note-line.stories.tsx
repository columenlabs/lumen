import { NoteLine } from '@columenlabs/lumen-ui';
import { Button } from '@columenlabs/lumen-ui/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlugIcon } from 'lucide-react';

const meta = {
  title: 'Feedback/NoteLine',
  component: NoteLine,
  parameters: {
    docs: {
      description: {
        component:
          'One muted line over a card or page: an icon, what it says, and an optional button.',
      },
    },
  },
  args: {
    icon: PlugIcon,
    title: 'Connect a data source',
    note: 'to see live numbers here.',
    action: (
      <Button size="sm" variant="outline">
        Connect
      </Button>
    ),
  },
} satisfies Meta<typeof NoteLine>;

export default meta;
export const Note: StoryObj<typeof meta> = {};
