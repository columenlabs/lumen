// The Widget picker's thumbnails ("drop-down … thumbnails and descriptions"):
// one small drawing per style in `WIDGET_STYLES`, in the theme's chart colours. Pictures only;
// the picker's row carries the name and when to use it.
import type { ReactNode } from 'react';

const C1 = 'var(--chart-1)';
const C2 = 'var(--chart-2)';
const C3 = 'var(--chart-3)';
const MUTED = 'var(--muted-foreground)';

const box = (children: ReactNode) => (
  <svg
    viewBox="0 0 40 28"
    className="h-7 w-10 rounded-[4px] bg-muted/60"
    aria-hidden
    focusable="false"
  >
    <title>Widget style</title>
    {children}
  </svg>
);
const line = (d: string, stroke = C1) => (
  <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
);

const THUMBS: Record<string, ReactNode> = {
  top_n: box(
    [6, 12, 18].map((y) => (
      <g key={y}>
        <rect x={5} y={y} width={16} height={3} rx={1} fill={MUTED} opacity={0.6} />
        <rect x={26} y={y} width={9} height={3} rx={1} fill={C1} />
      </g>
    )),
  ),
  card: box(
    <>
      <rect x={6} y={7} width={20} height={6} rx={1.5} fill={C1} />
      <rect x={6} y={17} width={14} height={3} rx={1} fill={MUTED} opacity={0.6} />
    </>,
  ),
  tiles: box(
    [4, 16, 28].map((x) => (
      <g key={x}>
        <rect x={x} y={9} width={8} height={5} rx={1} fill={C1} />
        <rect x={x} y={17} width={6} height={2} rx={1} fill={MUTED} opacity={0.6} />
      </g>
    )),
  ),
  'card:progress_bar': box(
    <>
      <rect x={6} y={7} width={14} height={5} rx={1.5} fill={C1} />
      <rect x={6} y={17} width={28} height={3} rx={1.5} fill={MUTED} opacity={0.3} />
      <rect x={6} y={17} width={19} height={3} rx={1.5} fill={C1} />
    </>,
  ),
  'card:progress_circle': box(
    <>
      <circle
        cx={20}
        cy={14}
        r={8}
        fill="none"
        stroke={MUTED}
        strokeOpacity={0.3}
        strokeWidth={3}
      />
      <path d="M20 6 A8 8 0 1 1 12.4 16.5" fill="none" stroke={C1} strokeWidth={3} />
    </>,
  ),
  'trend:spark': box(
    <>
      <rect x={5} y={5} width={12} height={5} rx={1.5} fill={C1} />
      {line('M5 22 L12 19 L18 21 L25 15 L30 17 L35 12')}
    </>,
  ),
  'trend:tracker': box(
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
      <rect
        key={i}
        x={4 + i * 4}
        y={10}
        width={3}
        height={8}
        rx={0.8}
        fill={i === 2 || i === 5 ? 'var(--loss)' : 'var(--gain)'}
      />
    )),
  ),
  allocation: box(
    <>
      <rect x={4} y={11} width={14} height={6} rx={1.5} fill={C1} />
      <rect x={19} y={11} width={9} height={6} rx={1.5} fill={C2} />
      <rect x={29} y={11} width={7} height={6} rx={1.5} fill={C3} />
    </>,
  ),
  donut: box(
    <>
      <circle cx={20} cy={14} r={8} fill="none" stroke={C2} strokeWidth={4} />
      <path d="M20 6 A8 8 0 0 1 27.6 16.5" fill="none" stroke={C1} strokeWidth={4} />
    </>,
  ),
  bars: box(
    <>
      <rect x={5} y={6} width={28} height={3.5} rx={1.5} fill={C1} />
      <rect x={5} y={12} width={20} height={3.5} rx={1.5} fill={C1} opacity={0.75} />
      <rect x={5} y={18} width={12} height={3.5} rx={1.5} fill={C1} opacity={0.5} />
    </>,
  ),
  'trend:line': box(
    <>
      {line('M5 21 L12 16 L18 18 L25 10 L35 7')}
      {line('M5 23 L14 21 L22 22 L30 17 L35 18', C2)}
    </>,
  ),
  'trend:area': box(
    <>
      <path d="M5 21 L12 15 L19 17 L26 9 L35 7 L35 24 L5 24 Z" fill={C1} opacity={0.25} />
      {line('M5 21 L12 15 L19 17 L26 9 L35 7')}
    </>,
  ),
  'trend:stacked': box(
    <>
      <path d="M5 24 L5 19 L14 17 L24 18 L35 14 L35 24 Z" fill={C2} opacity={0.5} />
      <path d="M5 19 L14 17 L24 18 L35 14 L35 8 L24 11 L14 9 L5 13 Z" fill={C1} opacity={0.5} />
    </>,
  ),
  'trend:bars': box(
    [6, 12, 18, 24, 30].map((x, i) => (
      <rect
        key={x}
        x={x}
        y={24 - ([8, 12, 9, 15, 13][i] ?? 0)}
        width={4}
        height={[8, 12, 9, 15, 13][i]}
        rx={1}
        fill={C1}
      />
    )),
  ),
  'trend:combo': box(
    <>
      {[6, 13, 20, 27].map((x, i) => (
        <rect
          key={x}
          x={x}
          y={24 - ([7, 10, 8, 12][i] ?? 0)}
          width={5}
          height={[7, 10, 8, 12][i]}
          rx={1}
          fill={C1}
          opacity={0.6}
        />
      ))}
      {line('M7 12 L15 9 L22 11 L30 6', C2)}
    </>,
  ),
  chart: box(
    [8, 14, 20, 26, 32].map((x, i) => (
      <g key={x}>
        <path
          d={`M${x} ${[8, 10, 6, 9, 5][i]} V${[20, 21, 17, 20, 15][i]}`}
          stroke={MUTED}
          strokeWidth={0.8}
        />
        <rect
          x={x - 1.5}
          y={[11, 13, 9, 12, 8][i]}
          width={3}
          height={5}
          fill={i % 2 ? 'var(--loss)' : 'var(--gain)'}
        />
      </g>
    )),
  ),
  growth: box(
    <>
      {line('M5 22 Q16 20 22 14 T35 6')}
      {line('M5 22 Q18 21 26 18 T35 15', MUTED)}
    </>,
  ),
  market: box(
    <>
      <rect
        x={4}
        y={6}
        width={15}
        height={16}
        rx={2}
        fill="none"
        stroke={MUTED}
        strokeOpacity={0.5}
      />
      <rect
        x={21}
        y={6}
        width={15}
        height={16}
        rx={2}
        fill="none"
        stroke={MUTED}
        strokeOpacity={0.5}
      />
      {line('M6 18 L10 14 L13 16 L17 10')}
      {line('M23 12 L27 16 L30 14 L34 18', 'var(--loss)')}
    </>,
  ),
};

/** A style's thumbnail (`WIDGET_STYLES` id); a style with none draws nothing. */
export const widgetThumb = (id: string) => THUMBS[id] ?? null;
