import { LumenEChart, axisStyle, useChartTokens } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const revenue = [82, 91, 88, 104, 112, 109, 121, 126, 118, 133, 141, 156];

function Demo() {
  const t = useChartTokens();
  return (
    <LumenEChart
      label="Revenue by month"
      option={{
        grid: { left: 40, right: 12, top: 12, bottom: 24 },
        xAxis: { type: 'category', data: months, ...axisStyle(t) },
        yAxis: { type: 'value', ...axisStyle(t) },
        tooltip: { trigger: 'axis' },
        series: [
          { type: 'bar', data: revenue, itemStyle: { color: t.series[0], borderRadius: 3 } },
        ],
      }}
    />
  );
}

const meta = {
  title: 'Components/Charts/LumenEChart',
  component: LumenEChart,
  parameters: {
    docs: {
      description: {
        component:
          'Any Apache ECharts option, themed: `useChartTokens` gives the theme’s colours and fonts and redraws on a theme change; `axisStyle` and `baseOption` style axes the kit’s way.',
      },
    },
  },
  args: { label: 'Revenue by month', option: {} },
  render: () => <Demo />,
} satisfies Meta<typeof LumenEChart>;

export default meta;
export const Bars: StoryObj<typeof meta> = {};
