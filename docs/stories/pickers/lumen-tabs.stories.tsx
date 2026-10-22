import { LumenTabs } from '@columenlabs/lumen-ui';
import { Badge } from '@columenlabs/lumen-ui/ui/badge';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BarChart3Icon, ListIcon, SettingsIcon } from 'lucide-react';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Frame/LumenTabs',
  component: LumenTabs,
  parameters: {
    docs: {
      description: {
        component:
          'A page’s tab row: every tab has an icon, a name and an optional count, and actions for the open tab sit at the row’s end.',
      },
    },
  },
  args: {
    value: 'list',
    onChange: () => {},
    tabs: [
      {
        value: 'list',
        label: 'Stores',
        icon: ListIcon,
        after: <Badge variant="secondary">12</Badge>,
      },
      { value: 'reports', label: 'Reports', icon: BarChart3Icon },
      { value: 'setup', label: 'Setup', icon: SettingsIcon },
    ],
  },
  render: function Render(args) {
    const [, update] = useArgs();
    return <LumenTabs {...args} onChange={(value) => update({ value })} />;
  },
} satisfies Meta<typeof LumenTabs>;

export default meta;
export const Tabs: StoryObj<typeof meta> = {};
