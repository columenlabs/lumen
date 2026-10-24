import { Button } from '@columenlabs/lumen-ui/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon } from 'lucide-react';

const meta = {
  title: 'Components/Base parts/Button',
  component: Button,
  args: { children: 'Save', variant: 'default', size: 'default' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'outline',
        'secondary',
        'ghost',
        'destructive',
        'destructive-confirm',
        'link',
      ],
    },
    size: {
      control: 'select',
      options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "shadcn/ui's Button in Lumen's theme. `destructive` stays muted until hovered and always opens a confirm; its final button is `destructive-confirm`.",
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          'default',
          'outline',
          'secondary',
          'ghost',
          'destructive',
          'destructive-confirm',
          'link',
        ] as const
      ).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const WithIcon: Story = {
  args: { variant: 'outline', children: undefined },
  render: (args) => (
    <Button {...args}>
      <PlusIcon data-icon="inline-start" />
      Add
    </Button>
  ),
};
