import { GrowthChart, type Series, paletteAt } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleBars } from '../util';

const curve = (seed: number, drift: number): [string, number][] =>
  sampleBars(500).map((b, i) => [b.time, (1 + i * drift) * (b.close / 100) ** seed]);

const lines: Series[] = [
  {
    key: 'a',
    label: 'Plan A',
    color: paletteAt(0),
    hold: false,
    dashed: false,
    points: curve(1, 0.0008),
  },
  {
    key: 'b',
    label: 'Plan B',
    color: paletteAt(1),
    hold: false,
    dashed: false,
    points: curve(0.6, 0.0012),
  },
  {
    key: 'bench',
    label: 'Benchmark',
    color: paletteAt(2),
    hold: true,
    dashed: true,
    points: curve(0.4, 0.0005),
  },
];

const meta = {
  title: 'Charts/GrowthChart',
  component: GrowthChart,
  parameters: {
    docs: {
      description: {
        component:
          'Growth of $1 for a set of lines on a log, linear or fit scale, with optional bands, markers and this year’s start. `format` changes the axis from `1.23×` to any unit.',
      },
    },
  },
  args: { lines, scale: 'log', className: 'h-72 w-full' },
} satisfies Meta<typeof GrowthChart>;

export default meta;
export const Growth: StoryObj<typeof meta> = {};
