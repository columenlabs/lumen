import type { meterTone } from '@columenlabs/lumen-ui-types/views';
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { type ChartConfig, ChartContainer } from './ui/chart';

/** A number's share of its target as a ring, its percent in the middle (Recharts); a meter's
 *  tone colours it, else the first chart colour. */
export function ProgressRing({
  value,
  tone,
}: {
  value: number | null;
  tone: ReturnType<typeof meterTone>;
}) {
  const config: ChartConfig = {
    v: { label: 'Progress', color: tone ? `var(--${tone})` : 'var(--chart-1)' },
  };
  return (
    <ChartContainer config={config} className="aspect-square size-16 shrink-0">
      <RadialBarChart
        data={[{ v: value ?? 0 }]}
        startAngle={90}
        endAngle={-270}
        innerRadius={24}
        outerRadius={32}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar
          dataKey="v"
          fill="var(--color-v)"
          background={{ fill: 'var(--muted)' }}
          cornerRadius={8}
          isAnimationActive={false}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="num fill-foreground"
          fontSize={12}
          fontWeight={600}
        >
          {value === null ? '—' : `${value.toFixed(0)}%`}
        </text>
      </RadialBarChart>
    </ChartContainer>
  );
}
