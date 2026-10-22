import { RenameField } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Pickers and panels/RenameField',
  component: RenameField,
  parameters: {
    docs: {
      description: {
        component:
          'A name renamed in place: Enter or leaving the field saves, Escape undoes, and empty or ↺ goes back to the source’s own name.',
      },
    },
  },
  args: {
    value: 'Main checking',
    original: 'CHK ••4410',
    originLabel: 'At the bank',
    onSave: () => {},
  },
  render: function Render(args) {
    const [, update] = useArgs();
    return <RenameField {...args} onSave={(name) => update({ value: name ?? args.original })} />;
  },
} satisfies Meta<typeof RenameField>;

export default meta;
export const Rename: StoryObj<typeof meta> = {};
