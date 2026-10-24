import { LumenCode } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Code/LumenCode',
  component: LumenCode,
  parameters: {
    docs: {
      description: {
        component:
          'Read-only code, highlighted by Shiki in the theme’s light and dark colours, with a copy button in its header.',
      },
    },
  },
  args: {
    lang: 'ts',
    lineNumbers: true,
    code: `import { LumenSelector } from '@columenlabs/lumen-ui';

export function Cadence({ value, onChange }: Props) {
  return <LumenSelector options={CADENCES} value={value} onChange={onChange} />;
}`,
  },
} satisfies Meta<typeof LumenCode>;

export default meta;
export const Code: StoryObj<typeof meta> = {};
