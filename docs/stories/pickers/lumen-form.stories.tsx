import { LumenForm } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { width } from '../util';

const meta = {
  title: 'Components/Pickers and panels/LumenForm',
  component: LumenForm,
  decorators: [width(420)],
  parameters: {
    docs: {
      description: {
        component:
          'A form from a list of fields: text, secret, number, date, textarea, select and multi. Each field checks itself; Save lists what needs fixing and takes you to it instead of saving.',
      },
    },
  },
  args: {
    onSave: fn(),
    onCancel: fn(),
    fields: [
      { id: 'name', label: 'Name', required: true, placeholder: 'Lisbon' },
      {
        id: 'url',
        label: 'Webhook',
        hint: 'Gets each event as JSON.',
        check: (v) => String(v).startsWith('https://') || 'Must start with https://',
      },
      { id: 'key', label: 'API key', kind: 'secret', saved: '••••3f9a' },
      {
        id: 'region',
        label: 'Region',
        kind: 'select',
        options: [
          { value: 'north', label: 'North' },
          { value: 'centre', label: 'Centre' },
          { value: 'south', label: 'South' },
        ],
      },
      { id: 'notes', label: 'Notes', kind: 'textarea' },
    ],
  },
} satisfies Meta<typeof LumenForm>;

export default meta;
export const Form: StoryObj<typeof meta> = {};
