// The icons a person can pick for a view; names are `viewIconNames` in
// `@columenlabs/lumen-ui-types/views`. A view without one shows its shape's icon.
import type { ViewIcon, ViewIconName, ViewShape } from '@columenlabs/lumen-ui-types/views';
import {
  BanknoteIcon,
  BriefcaseIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartLineIcon,
  ChartPieIcon,
  ClockIcon,
  CoinsIcon,
  FlameIcon,
  Grid3x3Icon,
  LandmarkIcon,
  LayersIcon,
  ListTreeIcon,
  type LucideIcon,
  PiggyBankIcon,
  ReceiptIcon,
  ShieldIcon,
  StarIcon,
  TableIcon,
  TagIcon,
  TargetIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
  ZapIcon,
} from 'lucide-react';
import type { IconName } from 'lucide-react/dynamic';
import { createElement, useEffect, useState } from 'react';
import { cn } from './lib/utils';
import type { NavIcon } from './nav';

export const VIEW_ICONS: Record<ViewIconName, LucideIcon> = {
  table: TableIcon,
  'list-tree': ListTreeIcon,
  grid: Grid3x3Icon,
  wallet: WalletIcon,
  receipt: ReceiptIcon,
  briefcase: BriefcaseIcon,
  landmark: LandmarkIcon,
  'piggy-bank': PiggyBankIcon,
  banknote: BanknoteIcon,
  coins: CoinsIcon,
  'chart-line': ChartLineIcon,
  'chart-bar': ChartBarIcon,
  'chart-pie': ChartPieIcon,
  'trending-up': TrendingUpIcon,
  'trending-down': TrendingDownIcon,
  target: TargetIcon,
  shield: ShieldIcon,
  star: StarIcon,
  zap: ZapIcon,
  flame: FlameIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  layers: LayersIcon,
  tag: TagIcon,
};

const SHAPE_ICONS: Record<ViewShape, LucideIcon> = {
  table: TableIcon,
  group: ListTreeIcon,
  pivot: Grid3x3Icon,
};

/** A view's sidebar icon: its own pick (a lucide name or an emoji), else its shape's. */
export const viewIcon = (config: { icon?: ViewIcon | null; shape: ViewShape }): NavIcon =>
  iconOf(config.icon, SHAPE_ICONS[config.shape]);

/** A picked icon (a lucide name or an emoji) as a component; `fallback` when none or unknown. */
export const iconOf = (icon: ViewIcon | null | undefined, fallback: NavIcon): NavIcon => {
  if (!icon) return fallback;
  if (icon in VIEW_ICONS) return VIEW_ICONS[icon as ViewIconName];
  if (/^[a-z]/.test(icon))
    return lucide && !lucide.names.has(icon) ? fallback : lucideIcon(icon, fallback);
  return emojiIcon(icon);
};

/**
 * lucide's name → icon map (every icon, each its own lazy file) loads on the first icon picked by
 * name, not with the app: the map alone is a few hundred KB of the first page's JavaScript.
 */
type Lucide = typeof import('lucide-react/dynamic') & { names: Set<string> };
let lucide: Lucide | undefined;
let loadingLucide: Promise<Lucide> | undefined;
function loadLucide(): Promise<Lucide> {
  if (!loadingLucide)
    loadingLucide = import('lucide-react/dynamic').then((m) => {
      lucide = { ...m, names: new Set<string>(m.iconNames) };
      return lucide;
    });
  return loadingLucide;
}

/** Every lucide icon name, for the icon picker's search: empty until `load` asks for the map and it lands. */
export function useLucideIconNames(load = true): readonly string[] {
  const [names, setNames] = useState<readonly string[]>(() => lucide?.iconNames ?? []);
  useEffect(() => {
    if (load && !names.length) loadLucide().then((m) => setNames(m.iconNames));
  }, [load, names.length]);
  return names;
}

/** A lucide icon by name: an empty slot its size while the map loads, `fallback` when it has no such icon. */
function LucideByName({
  name,
  fallback,
  className,
}: { name: string; fallback?: NavIcon; className?: string }) {
  const [, loaded] = useState(!!lucide);
  useEffect(() => {
    if (!lucide) loadLucide().then(() => loaded(true));
  }, []);
  if (!lucide)
    return createElement('span', {
      'aria-hidden': true,
      className: cn('inline-block size-4 shrink-0', className),
    });
  if (!lucide.names.has(name)) return fallback ? createElement(fallback, { className }) : null;
  return createElement(lucide.DynamicIcon, { name: name as IconName, className });
}
const made = new Map<string, NavIcon>();
/** One component per pick, so React keeps it between renders. */
const once = (key: string, make: () => NavIcon) => {
  let Icon = made.get(key);
  if (!Icon) {
    Icon = make();
    made.set(key, Icon);
  }
  return Icon;
};

/** Any lucide icon by name, loaded on first use (lucide's own DynamicIcon). */
export const lucideIcon = (name: string, fallback?: NavIcon): NavIcon =>
  once(
    `lucide:${name}`,
    () =>
      ({ className }) =>
        createElement(LucideByName, { name, fallback, className }),
  );

/** An emoji drawn where an icon goes. */
export const emojiIcon = (emoji: string): NavIcon =>
  once(
    `emoji:${emoji}`,
    () =>
      ({ className }) =>
        createElement(
          'span',
          {
            'aria-hidden': true,
            'data-slot': 'view-emoji',
            className: cn(
              'inline-grid size-4 shrink-0 place-items-center text-sm leading-none',
              className,
            ),
          },
          emoji,
        ),
  );

/** A shape's own icon (the Edit dialog's Shape picker). */
export const shapeIcon = (shape: ViewShape) => SHAPE_ICONS[shape];
