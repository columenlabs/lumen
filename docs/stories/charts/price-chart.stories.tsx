import { PriceChart, computeIndicators, resolveIndicator } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleBars } from '../util';

const bars = sampleBars(260);
const chosen = ['sma_20', 'sma_50', 'rsi_14'].flatMap((id) => resolveIndicator(id) ?? []);
const values = computeIndicators(bars, chosen);

const meta = {
  title: 'Charts/PriceChart',
  component: PriceChart,
  parameters: {
    docs: {
      description: {
        component:
          'A price chart on TradingView Lightweight Charts™: candles, OHLC bars, line, area or Heikin-Ashi, with volume, overlays on the price and a pane per oscillator. Indicators are worked out in the browser from the bars (`computeIndicators`). Made-up bars here.',
      },
    },
  },
  args: { bars, type: 'candles', chosen, values, className: 'h-96 w-full', navigator: true },
} satisfies Meta<typeof PriceChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Candles: Story = {};
export const Line: Story = { args: { type: 'line', chosen: [], values: {} } };
