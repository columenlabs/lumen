import { LumenFileField } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const meta = {
  title: 'Components/Pickers/LumenFileField',
  component: LumenFileField,
  parameters: {
    docs: {
      description: {
        component:
          'A file to bring in: drop it on the field or Choose one. The app holds the file, so setting it back to null after an upload empties the field.',
      },
    },
  },
  args: { file: null, onFile: () => {}, accept: '.csv,text/csv', label: 'CSV file' },
  render: (args) => {
    const [file, setFile] = useState<File | null>(null);
    return <LumenFileField {...args} file={file} onFile={setFile} />;
  },
} satisfies Meta<typeof LumenFileField>;

export default meta;
export const Csv: StoryObj<typeof meta> = {};
