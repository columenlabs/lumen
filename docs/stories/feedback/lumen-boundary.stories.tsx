import { LumenBoundary } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

function Broken(): never {
  throw new Error('This card failed on purpose.');
}

const meta = {
  title: 'Feedback/LumenBoundary',
  component: LumenBoundary,
  parameters: {
    docs: {
      description: {
        component:
          'Keeps a crash inside its card: the card says it hit an error, with Try again and Reload, and the page around it keeps working. Every grid card and widget body sits in one.',
      },
    },
  },
  args: { where: 'sample-card', children: <Broken /> },
} satisfies Meta<typeof LumenBoundary>;

export default meta;
export const CaughtError: StoryObj<typeof meta> = { name: 'A card that crashed' };
