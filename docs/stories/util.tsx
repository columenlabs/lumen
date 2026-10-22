import type { Decorator } from '@storybook/react-vite';

/** Gives a story a fixed width, as the part has in a card or a form. */
export const width =
  (px: number): Decorator =>
  (Story) => (
    <div style={{ width: px, maxWidth: '100%' }}>
      <Story />
    </div>
  );

/** Made-up daily bars for chart stories: a gentle random walk from 100. */
export function sampleBars(days = 260) {
  const out: {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];
  let close = 100;
  const start = Date.UTC(2025, 0, 2);
  for (let i = 0, d = 0; out.length < days; i++) {
    const day = new Date(start + i * 86_400_000);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const r = Math.sin(d * 12.9898) * 43758.5453;
    const step = (r - Math.floor(r) - 0.48) * 3;
    const open = close;
    close = Math.max(20, open + step);
    out.push({
      time: day.toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 1_000_000 + Math.round((r - Math.floor(r)) * 900_000),
    });
    d++;
  }
  return out;
}
