import { LumenCodeEditor } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Code/LumenCodeEditor',
  component: LumenCodeEditor,
  parameters: {
    docs: {
      description: {
        component:
          'An editable code box (CodeMirror) for SQL, JavaScript or JSON, loaded only when it first shows.',
      },
    },
  },
  args: {
    lang: 'sql',
    className: 'h-40',
    onChange: () => {},
    value:
      'SELECT region, sum(revenue) AS revenue\nFROM stores\nGROUP BY region\nORDER BY revenue DESC',
  },
  render: function Render(args) {
    const [, update] = useArgs();
    return <LumenCodeEditor {...args} onChange={(value) => update({ value })} />;
  },
} satisfies Meta<typeof LumenCodeEditor>;

export default meta;
export const Editor: StoryObj<typeof meta> = {};
