import { RankedBars } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const fill = 'var(--chart-1)';

const meta = {
  title: 'Components/Charts/RankedBars',
  component: RankedBars,
  parameters: {
    docs: {
      description: {
        component:
          'Labelled counts as a ranked list on full tracks. Each value carries its share: of all bars (`total`), of the first bar (`first`, for a funnel), your own text, or none. With no bars it shows `empty`.',
      },
    },
  },
  args: {
    label: 'Sign-ups by country',
    items: [
      { name: 'United States', v: 412, fill },
      { name: 'Canada', v: 96, fill },
      { name: 'United Kingdom', v: 61, fill },
    ],
  },
} satisfies Meta<typeof RankedBars>;

export default meta;
export const ShareOfTotal: StoryObj<typeof meta> = {};
export const Funnel: StoryObj<typeof meta> = {
  args: {
    label: 'Sign-up funnel',
    share: 'first',
    items: [
      { name: 'Visited', v: 1200, fill },
      { name: 'Started sign-up', v: 310, fill },
      { name: 'Verified email', v: 240, fill },
      { name: 'Connected a bank', v: 120, fill },
    ],
  },
};
export const Empty: StoryObj<typeof meta> = { args: { items: [] } };
