// What an app tells the kit about itself (the kit is product-neutral): where
// people's display preferences live and the line a market widget shows where the app has no feed.
// Set once at start with `configureLumen`. The assistant's name comes from its provider.
import { METER_LEVELS, type MeterLevels } from '@columenlabs/lumen-ui-types/views';
import type { Prefs } from './prefs';

export interface KitConfig {
  /** The cookie that keeps each person's display preferences. */
  prefsCookie: string;
  /** The cookie's `domain`, to share it across an app's hosts; none: this host only. */
  cookieDomain?: (host: string) => string | undefined;
  /** What a market widget says where the app has no live feed. */
  marketOff: string;
  /** The app's own defaults for preferences a person has not set (theme, time zone, ...). */
  defaultPrefs?: Partial<Prefs>;
  /** Where every meter turns amber (`watch`) and red (`alert`), as shares of a cap (0 to 1). */
  meterLevels: MeterLevels;
}

export const KIT: KitConfig = {
  prefsCookie: 'lumen_prefs',
  marketOff: 'Live market data is not on this app.',
  meterLevels: METER_LEVELS,
};

const changed = new Set<() => void>();
/** Runs `fn` after each `configureLumen` (preferences read again from the app's cookie). */
export function onConfigure(fn: () => void): void {
  changed.add(fn);
}

/** Sets what `c` names; the rest keep the kit's defaults (one meter level can move alone). */
export function configureLumen(
  c: Partial<Omit<KitConfig, 'meterLevels'>> & { meterLevels?: Partial<MeterLevels> },
): void {
  const { meterLevels, ...rest } = c;
  Object.assign(KIT, rest);
  if (meterLevels) KIT.meterLevels = { ...KIT.meterLevels, ...meterLevels };
  for (const fn of changed) fn();
}
