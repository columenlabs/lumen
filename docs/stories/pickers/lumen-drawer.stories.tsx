import { DrawerSection, LumenDrawer } from '@columenlabs/lumen-ui';
import { Button } from '@columenlabs/lumen-ui/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoIcon, ReceiptIcon } from 'lucide-react';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Pickers and panels/LumenDrawer',
  component: LumenDrawer,
  subcomponents: { DrawerSection },
  parameters: {
    docs: {
      description: {
        component:
          'The one pullout drawer: a right-side panel on desktop whose width drags (320px to 60%), a bottom sheet on phone. Its body holds `DrawerSection`s; its footer always shows (Close when you pass no actions).',
      },
      story: { inline: false, iframeHeight: 520 },
    },
  },
  args: {
    open: true,
    title: 'Lisbon',
    description: 'Flagship · opened Jan 2014',
    onClose: () => {},
    children: null,
  },
  render: function Render(args) {
    const [, update] = useArgs();
    return (
      <>
        <Button variant="outline" onClick={() => update({ open: true })}>
          Open drawer
        </Button>
        <LumenDrawer
          {...args}
          onClose={() => update({ open: false })}
          footer={<Button onClick={() => update({ open: false })}>Save</Button>}
        >
          <DrawerSection title="About" icon={InfoIcon} defaultOpen>
            <p className="text-sm">The first store, on the river front.</p>
          </DrawerSection>
          <DrawerSection title="Orders" icon={ReceiptIcon} count={1701}>
            <p className="text-sm">1,701 orders this month.</p>
          </DrawerSection>
        </LumenDrawer>
      </>
    );
  },
} satisfies Meta<typeof LumenDrawer>;

export default meta;
export const Drawer: StoryObj<typeof meta> = {};
