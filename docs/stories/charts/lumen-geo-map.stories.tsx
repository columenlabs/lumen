import { LumenGeoMap } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Components/Charts/LumenGeoMap',
  component: LumenGeoMap,
  parameters: {
    docs: {
      description: {
        component:
          'A world map shaded by one number per country (ISO alpha-2 codes); countries left out draw empty.',
      },
    },
  },
  args: {
    label: 'Visits by country',
    unit: 'visits',
    values: {
      PT: 4200,
      ES: 2600,
      FR: 1900,
      DE: 1500,
      GB: 1300,
      US: 3100,
      BR: 2200,
      CA: 600,
      IN: 900,
      JP: 400,
    },
  },
} satisfies Meta<typeof LumenGeoMap>;

export default meta;
export const World: StoryObj<typeof meta> = {};
