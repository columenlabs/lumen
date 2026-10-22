import { ResetButton } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

const meta = {
  title: 'Pickers and panels/ResetButton',
  component: ResetButton,
  parameters: {
    docs: {
      description: {
        component:
          'Puts a setting back to its default: a ↺ that shows only while something differs, its tooltip naming what it goes back to.',
      },
    },
  },
  args: { changed: true, label: 'Reset to 15 – 45', onReset: fn() },
} satisfies Meta<typeof ResetButton>;

export default meta;
export const Reset: StoryObj<typeof meta> = {};
