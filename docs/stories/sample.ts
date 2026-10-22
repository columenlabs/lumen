// Made-up rows every story shares: a chain of stores and their month. Nothing here is real data.
import type { ViewDomain } from '@columenlabs/lumen-ui';
import { customViewConfigSchema } from '@columenlabs/lumen-ui-types/views';
import type { CustomViewConfig } from '@columenlabs/lumen-ui-types/views';
import {
  BuildingIcon,
  CalendarIcon,
  DollarSignIcon,
  MapPinIcon,
  PercentIcon,
  ShoppingCartIcon,
  TagIcon,
} from 'lucide-react';

export interface Store {
  id: string;
  store: string;
  region: string;
  format: string;
  revenue: number;
  orders: number;
  growth: number;
  opened: string;
}

const CITIES = [
  ['Lisbon', 'South'],
  ['Porto', 'North'],
  ['Braga', 'North'],
  ['Faro', 'South'],
  ['Coimbra', 'Centre'],
  ['Aveiro', 'Centre'],
  ['Evora', 'South'],
  ['Leiria', 'Centre'],
  ['Viseu', 'Centre'],
  ['Guimaraes', 'North'],
  ['Setubal', 'South'],
  ['Funchal', 'Islands'],
] as const;
const FORMATS = ['Flagship', 'Street', 'Mall'] as const;

/** A steady pseudo-random number, so every build draws the same rows. */
const seeded = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

export const STORES: Store[] = CITIES.map(([city, region], i) => ({
  id: `st_${i + 1}`,
  store: city,
  region,
  format: FORMATS[i % FORMATS.length] ?? 'Street',
  revenue: Math.round(40_000 + seeded(i) * 160_000),
  orders: Math.round(600 + seeded(i + 40) * 2400),
  growth: Math.round((seeded(i + 80) - 0.4) * 400) / 10,
  opened: `20${String(14 + (i % 10)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}-01`,
}));

export const STORE_DOMAIN: ViewDomain<Store> = {
  id: 'stores',
  rowKey: (r) => r.id,
  text: (r) => [r.store],
  fields: [
    { key: 'store', label: 'Store', icon: BuildingIcon, value: (r) => r.store, format: 'text' },
    {
      key: 'region',
      label: 'Region',
      icon: MapPinIcon,
      value: (r) => r.region,
      format: 'text',
      filterable: true,
      groupable: true,
    },
    {
      key: 'format',
      label: 'Format',
      icon: TagIcon,
      value: (r) => r.format,
      format: 'text',
      filterable: true,
      groupable: true,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      icon: DollarSignIcon,
      value: (r) => r.revenue,
      format: 'price_rounded',
      aggregate: 'sum',
      filterable: true,
    },
    {
      key: 'orders',
      label: 'Orders',
      icon: ShoppingCartIcon,
      value: (r) => r.orders,
      format: 'integer',
      aggregate: 'sum',
      filterable: true,
    },
    {
      key: 'growth',
      label: 'Growth',
      icon: PercentIcon,
      value: (r) => r.growth,
      format: 'percent',
      aggregate: 'mean',
      filterable: true,
    },
    {
      key: 'opened',
      label: 'Opened',
      icon: CalendarIcon,
      value: (r) => r.opened,
      format: 'text',
    },
  ],
};

/** A saved view over the stores: its columns, sort and the cards on its page. */
export const storeView = (over: Record<string, unknown> = {}): CustomViewConfig => ({
  name: 'Stores',
  ...customViewConfigSchema.parse({
    columns: ['store', 'region', 'format', 'revenue', 'orders', 'growth', 'opened'],
    sort: { key: 'revenue', desc: true },
    ...over,
  }),
});
