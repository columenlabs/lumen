// LumenGeoMap: a world map shaded by a number per country (visits, people, revenue), drawn by
// ECharts' map chart over Natural Earth's 110m countries (world-atlas). Countries are keyed by
// ISO 3166-1 alpha-2 code ("US", "GB"), the code most sources report. The map and its outlines
// load in their own chunk the first time a page draws one.
import { useEffect, useMemo, useState } from 'react';
import { LumenEChart, baseOption, useChartTokens } from './lumen-echart';

type World = {
  /** The map's key for an ISO alpha-2 code: its numeric code ("US" → "840"). */
  key: (alpha2: string) => string | undefined;
  /** A country's name by that key. */
  name: (key: string) => string;
};

const ANTARCTICA = '010';
/** Russia and Fiji, by numeric code. */
const ACROSS_180 = new Set(['643', '242']);
/** Points this far west belong to the shape's eastern end. */
const FAR_WEST = -150;
const FULL_TURN = 360;
/** The map's height when the caller gives none, as LumenEChart's. */
const HEIGHT = 260;
/** Country borders, thin enough to read small countries at 110m. */
const BORDER = 0.5;

/**
 * A CSS colour as `rgb(r, g, b)`. ECharts blends a visual map's colours itself and reads only hex
 * and rgb, so a theme colour in another form (`oklch(…)`, `color-mix(…)`) blends to black. The
 * browser paints it on one pixel and the pixel is read back.
 */
function toRgb(color: string) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Moves every far-west longitude in nested GeoJSON coordinates one turn east, in place. */
function unwrap(c: unknown) {
  if (!Array.isArray(c)) return;
  if (typeof c[0] === 'number') {
    if (c[0] < FAR_WEST) c[0] += FULL_TURN;
    return;
  }
  for (const inner of c) unwrap(inner);
}

/** Registers the map chart and the world outlines with ECharts once. */
let loading: Promise<World> | null = null;
function loadWorld() {
  loading ??= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('topojson-client'),
    import('world-atlas/countries-110m.json'),
    import('i18n-iso-countries'),
  ]).then(([core, charts, topo, atlas, iso]) => {
    core.use([charts.MapChart]);
    const world = atlas.default as unknown as Parameters<typeof topo.feature>[0];
    const fc = topo.feature(world, world.objects.countries as never) as unknown as {
      type: 'FeatureCollection';
      features: {
        id?: string;
        properties: { name: string; key?: string };
        geometry: { type: string; coordinates: unknown };
      }[];
    };
    // Antarctica takes a third of the height and holds no one; Russia and Fiji cross the date
    // line, so their far-east points move past 180° to keep each shape in one piece.
    fc.features = fc.features.filter((f) => f.id !== ANTARCTICA);
    for (const f of fc.features) if (f.id && ACROSS_180.has(f.id)) unwrap(f.geometry.coordinates);
    // ECharts matches data to a feature by a property, and world-atlas keeps the numeric code
    // in the feature's own id, so copy it into the properties.
    const names = new Map<string, string>();
    for (const f of fc.features) {
      f.properties.key = f.id ?? f.properties.name;
      names.set(f.properties.key, f.properties.name);
    }
    core.registerMap('world', fc as never);
    return {
      key: (alpha2: string) => iso.default.alpha2ToNumeric(alpha2),
      name: (key: string) => names.get(key) ?? key,
    };
  });
  return loading;
}

export function LumenGeoMap({
  values,
  label,
  unit,
  height = HEIGHT,
}: {
  /** The number for each country, by ISO alpha-2 code; countries left out draw empty. */
  values: Record<string, number>;
  /** What the map shows, for screen readers. */
  label: string;
  /** What the number counts ("visits"), shown in the tooltip after it. */
  unit?: string;
  height?: number;
}) {
  const t = useChartTokens();
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let alive = true;
    loadWorld().then((w) => alive && setWorld(w));
    return () => {
      alive = false;
    };
  }, []);

  const option = useMemo(() => {
    if (!world) return null;
    const data = Object.entries(values).flatMap(([code, value]) => {
      const id = world.key(code.toUpperCase());
      return id ? [{ name: id, value }] : [];
    });
    const max = Math.max(1, ...data.map((d) => d.value));
    const base = baseOption(t);
    return {
      ...base,
      tooltip: {
        ...(base.tooltip as object),
        trigger: 'item',
        formatter: (p: { name: string; value?: number }) => {
          const value = Number.isFinite(p.value) ? (p.value as number) : 0;
          return `${world.name(p.name)}: ${value.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`;
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max,
        inRange: { color: [toRgb(t.border), toRgb(t.primary)] },
      },
      series: [
        {
          type: 'map',
          map: 'world',
          nameProperty: 'key',
          roam: false,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          data,
          itemStyle: { areaColor: t.border, borderColor: t.card, borderWidth: BORDER },
          emphasis: { label: { show: false }, itemStyle: { areaColor: t.series[5] ?? t.primary } },
          select: { disabled: true },
        },
      ],
    };
  }, [world, values, unit, t]);

  if (!option) {
    return (
      <div
        role="img"
        aria-label={label}
        className="w-full animate-pulse rounded-md bg-muted/40"
        style={{ height }}
      />
    );
  }
  return <LumenEChart label={label} option={option} height={height} />;
}
