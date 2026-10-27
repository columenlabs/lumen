// Text that stays readable on a colour the app does not choose (a mailbox's own label colours).

const hex = (c: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  const d = m?.[1];
  if (!d) return null;
  const h = d.length === 3 ? [...d].map((x) => x + x).join('') : d;
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast of two hex colours, 1 to 21; null when either is not a hex colour. */
export function contrast(a: string, b: string): number | null {
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return null;
  const p = luminance(x);
  const q = luminance(y);
  return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
}

/**
 * The text colour for a chip of background `bg`: its own `ink` when that reads at `min`:1 (WCAG AA,
 * 4.5), otherwise near-black or white, whichever reads better. A colour that is not hex keeps `ink`.
 */
export function readableInk(bg: string, ink?: string, min = 4.5): string | undefined {
  if (ink && (contrast(bg, ink) ?? min) >= min) return ink;
  const dark = contrast(bg, '#111111');
  const light = contrast(bg, '#ffffff');
  if (dark === null || light === null) return ink;
  return dark >= light ? '#111111' : '#ffffff';
}
