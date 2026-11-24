import { type ExplorerItem, type ExplorerToggle, LumenExplorer } from '@columenlabs/lumen-ui';
import { DropdownMenuItem } from '@columenlabs/lumen-ui/ui/dropdown-menu';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BoxIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  MoveHorizontalIcon,
  PinIcon,
  RulerIcon,
  SparklesIcon,
} from 'lucide-react';
import { useState } from 'react';

const meta = {
  title: 'Components/Views/LumenExplorer',
  component: LumenExplorer,
  parameters: {
    docs: {
      description: {
        component:
          'The one explorer row and tree: parts, parameters, steps, dimensions, folders. Fixed slots (chevron, icon with its status dot, name, meta, field, toggles); hover changes opacity only, so nothing moves. The ⋯ floats left of the field on hover, and right-click opens the same menu. docs/parts/explorer.md.',
      },
    },
  },
  args: { data: [], label: 'Explorer' },
} satisfies Meta<typeof LumenExplorer>;

export default meta;
type Story = StoryObj<typeof meta>;

function Parts({ touch }: { touch?: boolean }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({ c: true });
  const [sel, setSel] = useState<string[]>([]);
  const eye: ExplorerToggle = {
    id: 'visible',
    icon: EyeIcon,
    offIcon: EyeOffIcon,
    rest: true,
    label: (it, on) => `${on ? 'Hide' : 'Show'} ${it.name}`,
    onToggle: (it, on) => setHidden((h) => ({ ...h, [it.id]: !on })),
  };
  const part = (id: string, name: string, meta?: string): ExplorerItem => ({
    id,
    name,
    icon: BoxIcon,
    meta,
    on: { visible: !hidden[id] },
    dim: hidden[id],
  });
  const data: ExplorerItem[] = [
    {
      id: 'f',
      name: 'Assembly',
      icon: FolderIcon,
      tint: '#d99a1e',
      folder: true,
      children: [part('a', 'Bracket', 'PLA'), part('b', 'Lid', '×2')],
    },
    {
      ...part('c', 'Base plate with a long name that ends in an ellipsis'),
      status: { tone: 'warn', label: 'Rebuilt with a warning' },
    },
  ];
  return (
    <div className="h-48 w-72 rounded-lg border p-1">
      <LumenExplorer
        label="Parts"
        data={data}
        toggles={[eye]}
        touch={touch}
        selection={sel}
        onSelect={setSel}
        menu={() => <DropdownMenuItem>Isolate</DropdownMenuItem>}
        renameInMenu
        onRename={() => {}}
        onMove={() => {}}
      />
    </div>
  );
}

function Parameters() {
  const [vals, setVals] = useState<Record<string, number>>({ w: 60, h: 140 });
  const [pins, setPins] = useState<Record<string, boolean>>({ w: true });
  const pin: ExplorerToggle = {
    id: 'pin',
    icon: PinIcon,
    rest: false,
    quiet: true,
    slot: 'icon',
    when: (it) => !it.folder,
    label: (it, on) => `${on ? 'Unpin' : 'Pin'} ${it.name}`,
    onToggle: (it, on) => setPins((p) => ({ ...p, [it.id]: on })),
  };
  const size = (id: string, name: string, text: string, tags: string[]): ExplorerItem => ({
    id,
    name,
    icon: MoveHorizontalIcon,
    on: { pin: !!pins[id] },
    info: { text, tags },
    field: {
      kind: 'number',
      value: vals[id] ?? 0,
      unit: 'mm',
      hint: { min: 20, max: 120 },
      limit: { min: 1 },
      onChange: (v) => setVals((x) => ({ ...x, [id]: Number(v) })),
    },
  });
  const data: ExplorerItem[] = [
    {
      id: 'g',
      name: 'Body',
      icon: FolderIcon,
      tint: '#d99a1e',
      folder: true,
      locked: true,
      children: [
        size('w', 'Width', 'Sets the base width.', ['Base']),
        size('h', 'Height', 'Sets the tower height.', ['Bracket', 'Lid']),
      ],
    },
  ];
  return (
    <div className="w-72 rounded-lg border p-1">
      <LumenExplorer
        label="Parameters"
        data={data}
        toggles={[pin]}
        groupMeta="none"
        height={90}
        menu={(it) =>
          it.folder ? null : (
            <>
              <DropdownMenuItem>
                <RulerIcon />
                Show as dimension
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SparklesIcon />
                Ask about it
              </DropdownMenuItem>
            </>
          )
        }
      />
    </div>
  );
}

export const PartsList: Story = { render: () => <Parts /> };
export const ParametersWithFields: Story = { render: () => <Parameters /> };
export const Touch: Story = { render: () => <Parts touch /> };
