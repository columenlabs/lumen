// The frame a page-level story sits in: the kit's own LumenShell with a short sidebar, as an app
// mounts it. Pages (LumenLayout, PageHeader) read the shell around them, so they need it.
import { LumenShell, NavGroup } from '@columenlabs/lumen-ui';
import { BarChart3Icon, HomeIcon, SettingsIcon, StoreIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const nav = (
  <NavGroup
    label="Sample app"
    items={[
      { title: 'Home', to: '/', icon: HomeIcon, exact: true },
      { title: 'Stores', to: '/stores', icon: StoreIcon },
      { title: 'Reports', to: '/reports', icon: BarChart3Icon },
      { title: 'Setup', to: '/setup', icon: SettingsIcon },
    ]}
  />
);

export function SampleShell({ children }: { children: ReactNode }) {
  return (
    <LumenShell
      app="sample"
      appLabel="Sample app"
      brand={<span className="px-2 font-semibold">Sample app</span>}
      nav={nav}
      user={{ email: 'ada@example.com', name: 'Ada Lovelace' }}
    >
      {children}
    </LumenShell>
  );
}
