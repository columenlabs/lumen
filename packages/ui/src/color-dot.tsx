// A value's colour as a small dot (an app categories and labels): before
// the value in a cell, a chip and a picker's row. The colour is any CSS colour, a theme token
// such as `var(--chart-3)` for it to read in light and dark.
import type { ComponentType, ReactNode } from 'react';
import { cn } from './lib/utils';

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center', className)}>
      <span className="size-2.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

const icons = new Map<string, ComponentType<{ className?: string }>>();

/** The dot as an icon component, for an `LumenOption.icon`; one per colour, so it keeps its identity. */
export function colorIcon(color: string): ComponentType<{ className?: string }> {
  let icon = icons.get(color);
  if (!icon) {
    icon = ({ className }) => <ColorDot color={color} className={className} />;
    icons.set(color, icon);
  }
  return icon;
}

const tinted = new WeakMap<
  ComponentType<{ className?: string }>,
  Map<string, ComponentType<{ className?: string }>>
>();

/** `icon` drawn in `color` (a label's icon in the label's colour), kept per pair so it keeps its identity. */
export function tintedIcon(
  icon: ComponentType<{ className?: string }>,
  color: string | undefined,
): ComponentType<{ className?: string }> {
  if (!color) return icon;
  let byColor = tinted.get(icon);
  if (!byColor) {
    byColor = new Map();
    tinted.set(icon, byColor);
  }
  let out = byColor.get(color);
  if (!out) {
    const Icon = icon;
    out = ({ className }) => (
      <span aria-hidden className="flex shrink-0" style={{ color }}>
        <Icon className={cn('size-4', className)} />
      </span>
    );
    byColor.set(color, out);
  }
  return out;
}

/** A value as a chip in its colour (a label): a tint behind, the colour as text, its icon first. */
export function ColorChip({
  color,
  icon: Icon,
  children,
}: {
  color?: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-secondary px-1.5 text-xs font-medium whitespace-nowrap text-secondary-foreground"
      style={
        color
          ? {
              background: `color-mix(in oklab, ${color} 18%, transparent)`,
              // The colour pulled toward the text colour, so a light hue (yellow, sky) still reads.
              color: `color-mix(in oklab, ${color} 55%, var(--foreground))`,
            }
          : undefined
      }
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      {children}
    </span>
  );
}
