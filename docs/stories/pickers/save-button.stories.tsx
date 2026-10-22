import { SaveButton } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

const meta = {
  title: 'Pickers and panels/SaveButton',
  component: SaveButton,
  parameters: {
    docs: {
      description: {
        component:
          'Save that says why it cannot save: with issues, a chip before it counts them and lists each; tapping Save takes you to the first one. Never a bare disabled button.',
      },
    },
  },
  args: { issues: [], onSave: fn() },
} satisfies Meta<typeof SaveButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const WithIssues: Story = {
  name: 'With issues',
  args: {
    issues: [
      { where: 'Name', message: 'Name is needed' },
      { where: 'Webhook', message: 'Must start with https://' },
    ],
  },
};
