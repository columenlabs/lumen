// Mockup: "Lumen in play" — the whole app frame with a real dashboard page inside it, as a
// consumer mounts it. This is the holistic hero of the redesigned docs: App shell level.
import {
  LumenLayout,
  LumenShell,
  NavGroup,
  StatusHealth,
  StatusItem,
  useLumenLoad,
} from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3Icon,
  BoxIcon,
  HomeIcon,
  LayersIcon,
  LineChartIcon,
  MapPinIcon,
  SettingsIcon,
  StoreIcon,
} from 'lucide-react';
import { useState } from 'react';
import { STORES, STORE_DOMAIN, storeView } from '../sample';

const nav = (
  <>
    <NavGroup
      label="Northwind"
      items={[
        { title: 'Dashboard', to: '/', icon: HomeIcon, exact: true },
        { title: 'Stores', to: '/stores', icon: StoreIcon },
        { title: 'Regions', to: '/regions', icon: MapPinIcon },
        { title: 'Reports', to: '/reports', icon: BarChart3Icon },
      ]}
    />
    <NavGroup
      label="Build"
      items={[
        { title: 'Views', to: '/views', icon: LayersIcon },
        { title: 'Charts', to: '/charts', icon: LineChartIcon },
        { title: 'Catalog', to: '/catalog', icon: BoxIcon },
        { title: 'Setup', to: '/setup', icon: SettingsIcon },
      ]}
    />
  </>
);

const dashboard = storeView({
  cards: [
    {
      id: 'summary',
      kind: 'metric',
      style: 'row',
      w: 6,
      tiles: [
        { key: 'rev', label: 'Revenue', field: 'revenue', agg: 'sum' },
        { key: 'ord', label: 'Orders', field: 'orders', agg: 'sum' },
        { key: 'gro', label: 'Growth', field: 'growth', agg: 'mean', sign: true },
      ],
    },
    { id: 'by_region', kind: 'allocation', style: 'donut', by: 'region', value: 'revenue', w: 3 },
    {
      id: 'by_format',
      kind: 'allocation',
      style: 'bar_list',
      by: 'format',
      value: 'revenue',
      w: 3,
    },
    { id: 'view', kind: 'table', style: 'table', w: 6 },
  ],
});

function Dashboard() {
  const query = useQuery({ queryKey: ['overview-stores'], queryFn: async () => STORES });
  const load = useLumenLoad(query);
  const [config, setConfig] = useState(() => dashboard);
  return (
    <LumenLayout
      crumbs={[{ label: 'Dashboard' }]}
      domain={STORE_DOMAIN}
      config={config}
      rows={query.data ?? []}
      load={load}
      onConfigChange={setConfig}
      rowTitle={(r) => r.store}
    />
  );
}

const meta = {
  title: 'App shell/Lumen in play',
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen' },
  render: () => (
    <LumenShell
      app="northwind"
      appLabel="Northwind"
      brand={<span className="px-2 font-semibold">Northwind</span>}
      nav={nav}
      user={{ email: 'ada@example.com', name: 'Ada Lovelace' }}
      status={
        <>
          <StatusItem label="12 stores" />
          <StatusItem label="Synced" value="2m ago" ok />
        </>
      }
      health={
        <StatusHealth
          probes={[
            { name: 'API', ok: true },
            { name: 'Warehouse', ok: true },
            { name: 'Jobs', ok: true },
          ]}
          checked="just now"
        />
      }
      statusEnd={<StatusItem label="v0.1.20" />}
    >
      <Dashboard />
    </LumenShell>
  ),
} satisfies Meta;

export default meta;
export const InPlay: StoryObj<typeof meta> = { name: 'Lumen in play' };
