// How full a meter reads, the same way in every app: grey while there is room, amber from the
// `watch` level, red from `alert` (75% and 90% unless the app moved them with `configureLumen`).
// `ShareMeter` and `UnitValue` colour themselves with it; anything else drawing a share of a cap
// (a dot, a chip, a "Watch for" cell) calls `meterLevel` rather than its own numbers.
import type { MeterLevel, MeterLevels } from '@columenlabs/lumen-ui-types/views';
import { KIT } from './kit-config';

/** The level of `share` (0 to 1 of a cap), on the app's levels or this meter's own `levels`. */
export function meterLevel(share: number, levels?: Partial<MeterLevels>): MeterLevel {
  const { watch, alert } = { ...KIT.meterLevels, ...levels };
  return share >= alert ? 'alert' : share >= watch ? 'watch' : 'ok';
}

/** Each level's colour, theme tokens: `ok` is a quiet grey so only a meter near its cap draws the eye. */
export const METER_LEVEL_COLOR: Record<MeterLevel, string> = {
  ok: 'color-mix(in oklab, var(--muted-foreground) 55%, transparent)',
  watch: 'var(--warning)',
  alert: 'var(--loss)',
};

/** A share's `UnitValue` tone: none while `ok`. */
export const meterValueTone = (share: number, levels?: Partial<MeterLevels>) =>
  (({ ok: undefined, watch: 'warning', alert: 'loss' }) as const)[meterLevel(share, levels)];
