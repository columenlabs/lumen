import { LumenSelector, SettingColumns, SettingField } from '@columenlabs/lumen-ui';
import { Switch } from '@columenlabs/lumen-ui/ui/switch';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useState } from 'react';

const MODELS = [
  { value: 'sol', label: 'GPT-6.2 Sol' },
  { value: 'terra', label: 'GPT-6.1 Terra' },
  { value: 'haiku', label: 'Claude Haiku 5.5' },
  { value: 'long', label: 'A very long model name that a provider might ship one day' },
];
const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const JOBS = [
  { id: 'default', label: 'Default', model: 'sol', effort: 'medium', on: true },
  { id: 'reviewer', label: 'Prompt reviewer', model: 'haiku', effort: 'low', on: false },
  { id: 'chat', label: 'Chat', model: 'terra', effort: 'low', on: true },
  { id: 'edits', label: 'Hard edits', model: 'sol', effort: 'medium', on: true },
  { id: 'names', label: 'Chat names', model: 'haiku', effort: 'low', on: false },
  { id: 'rebuild', label: 'Rebuild', model: 'sol', effort: 'medium', on: true },
  {
    id: 'long',
    label: 'A job with a long name that runs on and on',
    model: 'long',
    effort: 'high',
    on: true,
  },
];

function Job({ j }: { j: (typeof JOBS)[number] }) {
  const [model, setModel] = useState(j.model);
  const [effort, setEffort] = useState(j.effort);
  const [on, setOn] = useState(j.on);
  return (
    <SettingField
      label={j.label}
      end={<Switch checked={on} onCheckedChange={setOn} aria-label={`${j.label} on`} />}
    >
      <LumenSelector
        label={`Model for ${j.label}`}
        value={model}
        options={MODELS}
        onChange={setModel}
      />
      <LumenSelector
        label={`Effort for ${j.label}`}
        value={effort}
        options={EFFORTS}
        onChange={setEffort}
      />
    </SettingField>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="rounded-lg border bg-card p-4">{children}</div>
    </div>
  );
}

const meta = {
  title: 'Components/Blocks/SettingColumns',
  component: SettingColumns,
  parameters: {
    docs: {
      description: {
        component:
          "Rows of the same controls in shared columns: each control of a `SettingField` takes its own column, as wide as that column's widest control (up to `max`), so every row's pickers start and end on the same edges. CSS grid with subgrid; on a phone the label takes its own line above its controls.",
      },
    },
  },
  args: { columns: 2 },
} satisfies Meta<typeof SettingColumns>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each `SettingField` wrapped in `SettingColumns`: the columns line up. */
export const Aligned: Story = {
  render: (args) => (
    <Frame title="SettingColumns">
      <SettingColumns {...args}>
        {JOBS.map((j) => (
          <Job key={j.id} j={j} />
        ))}
      </SettingColumns>
    </Frame>
  ),
};

/** The same rows without it: each control sizes to its own value, so the edges wander. */
export const WithoutColumns: Story = {
  render: () => (
    <Frame title="SettingField rows alone">
      <div className="flex flex-col">
        {JOBS.map((j) => (
          <Job key={j.id} j={j} />
        ))}
      </div>
    </Frame>
  ),
};
