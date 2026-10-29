// How full a meter reads, the same way in every app. A usage meter is green while there is room,
// amber from `watch` (75%), orange from `alert` (90%) and red from `over` (the cap). A health
// meter (uptime, success rate) is green at 99% and over, amber down to 95%, red below.
// `ShareMeter` and `UnitValue` colour themselves with it; anything else drawing a share of a cap
// (a dot, a chip, a "Watch for" cell) calls `meterLevel` rather than its own numbers.
import {
  type HealthLevels,
  type MeterKind,
  type MeterLevel,
  type MeterLevels,
  healthLevel,
  usageLevel,
} from '@columenlabs/lumen-ui-types/views';
import { KIT } from './kit-config';

/**
 * The level of `share` (0 to 1), on the app's levels or this meter's own `levels`. `kind`
 * `health` reads it the other way (higher is better) on the app's `healthLevels`.
 */
export function meterLevel(
  share: number,
  levels?: Partial<MeterLevels> | Partial<HealthLevels>,
  kind: MeterKind = 'usage',
): MeterLevel {
  return kind === 'health'
    ? healthLevel(share, { ...KIT.healthLevels, ...levels })
    : usageLevel(share, { ...KIT.meterLevels, ...levels });
}

/** Each level's colour on a bar, a dot or a chip's tint: theme tokens (`theme.css`). */
export const METER_LEVEL_COLOR: Record<MeterLevel, string> = {
  ok: 'var(--meter-ok)',
  watch: 'var(--meter-watch)',
  alert: 'var(--meter-alert)',
  over: 'var(--meter-over)',
};

/** Each level's text colour on its own tint (a chip): darker than the fill, so it reads at 4.5:1. */
export const METER_LEVEL_TEXT: Record<MeterLevel, string> = {
  ok: 'var(--foreground)',
  watch: 'var(--warning)',
  alert: 'var(--caution)',
  over: 'var(--loss)',
};

/** A share's `UnitValue` tone: none while `ok`, so only a number that needs a look is tinted. */
export const meterValueTone = (
  share: number,
  levels?: Partial<MeterLevels> | Partial<HealthLevels>,
  kind?: MeterKind,
) =>
  (({ ok: undefined, watch: 'warning', alert: 'caution', over: 'loss' }) as const)[
    meterLevel(share, levels, kind)
  ];
