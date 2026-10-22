import { Badge } from '@columenlabs/lumen-ui/ui/badge';
import type { Meta, StoryObj } from '@storybook/react-vite';

const VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
  'success',
  'warning',
  'info',
] as const;

const meta = {
  title: 'Base parts/Badge',
  component: Badge,
  args: { children: 'Live', variant: 'success' },
  argTypes: { variant: { control: 'select', options: VARIANTS } },
  parameters: {
    docs: {
      description: {
        component: "shadcn/ui's Badge with Lumen's `success`, `warning` and `info` tones added.",
      },
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {VARIANTS.map((variant) => (
        <Badge key={variant} {...args} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};
