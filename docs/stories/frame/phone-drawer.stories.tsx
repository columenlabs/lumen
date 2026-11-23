import {
  IconButton,
  LumenPhoneDrawer,
  PhoneDrawerFilter,
  PhoneDrawerHeader,
  type PhoneDrawerSize,
} from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BoxIcon, EyeIcon, Redo2Icon, SlidersHorizontalIcon, Undo2Icon } from 'lucide-react';
import { useState } from 'react';

function Rows({ n = 12 }: { n?: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {Array.from({ length: n }, (_, i) => `Part ${i + 1}`).map((name) => (
        <div key={name} className="flex h-7.5 items-center gap-2 px-3 text-sm">
          <BoxIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <EyeIcon className="size-4 text-muted-foreground" />
        </div>
      ))}
    </div>
  );
}

function Filtered() {
  const [filter, setFilter] = useState<'all' | 'fav' | 'changed'>('all');
  return (
    <>
      <PhoneDrawerHeader>
        <PhoneDrawerFilter
          options={[
            { value: 'all', label: 'All' },
            { value: 'fav', label: 'Favorites' },
            { value: 'changed', label: 'Changed', after: 2 },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </PhoneDrawerHeader>
      <Rows />
    </>
  );
}

function Versions() {
  return (
    <>
      <PhoneDrawerHeader>
        <IconButton icon={Undo2Icon} label="Undo" />
        <IconButton icon={Redo2Icon} label="Redo" disabled />
        <span className="ml-1 text-sm">
          <b className="num">v6</b> <span className="text-muted-foreground">of 6</span>
        </span>
      </PhoneDrawerHeader>
      <Rows n={6} />
    </>
  );
}

/** A phone screen: the page (a canvas) and the drawer share one flex box. */
function Phone({
  sideways,
  size: start = 'normal',
  slot,
}: { sideways?: boolean; size?: PhoneDrawerSize; slot?: 'filter' | 'versions' }) {
  const [open, setOpen] = useState(true);
  const [size, setSize] = useState<PhoneDrawerSize>(start);
  return (
    <div
      className={`flex overflow-hidden border bg-background ${sideways ? 'flex-row' : 'flex-col'}`}
      style={sideways ? { width: 844, height: 390 } : { width: 390, height: 844 }}
    >
      <button
        type="button"
        className="grid min-h-0 min-w-0 flex-1 place-items-center bg-muted text-sm text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        Page (live)
      </button>
      <LumenPhoneDrawer
        title={slot === 'filter' ? 'Parameters' : slot === 'versions' ? 'Versions' : 'Parts'}
        icon={slot === 'filter' ? SlidersHorizontalIcon : BoxIcon}
        open={open}
        sideways={sideways}
        size={size}
        onSizeChange={setSize}
        onClose={() => setOpen(false)}
      >
        {slot === 'filter' ? <Filtered /> : slot === 'versions' ? <Versions /> : <Rows />}
      </LumenPhoneDrawer>
    </div>
  );
}

const meta = {
  title: 'Components/Frame/LumenPhoneDrawer',
  component: Phone,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A phone panel beside a live page: from the bottom upright, docked right sideways. Minimize, maximize or restore, close. Panels put their own controls in the header slot with `PhoneDrawerHeader`.',
      },
    },
  },
} satisfies Meta<typeof Phone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Upright: Story = {};
export const UprightMinimized: Story = { args: { size: 'min' } };
export const UprightMaximized: Story = { args: { size: 'max' } };
export const HeaderFilter: Story = { args: { slot: 'filter' } };
export const HeaderVersions: Story = { args: { slot: 'versions' } };
export const Sideways: Story = { args: { sideways: true } };
export const SidewaysMinimized: Story = { args: { sideways: true, size: 'min' } };
export const SidewaysMaximized: Story = { args: { sideways: true, size: 'max', slot: 'filter' } };
