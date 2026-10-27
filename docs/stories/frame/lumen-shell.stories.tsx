import { LumenLayout, LumenShell, NavGroup, NoteLine, Tile, TileRow } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BarChart3Icon, HomeIcon, InfoIcon, SettingsIcon, StoreIcon } from 'lucide-react';

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

const meta = {
  title: 'App shell/LumenShell',
  component: LumenShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The app frame: sidebar (icons-only collapse, a drawer on phone), page header, status bar, Settings and the profile menu. An app passes its brand, nav and routed page; its own parts go in the slots `brand`, `headerActions`, `panel`, `wrap`, `shared`, `profile` and `statusEnd`.',
      },
      story: { inline: false, iframeHeight: 560 },
    },
  },
  args: {
    app: 'sample',
    appLabel: 'Sample app',
    brand: <span className="px-2 font-semibold">Sample app</span>,
    nav,
    user: { email: 'ada@example.com', name: 'Ada Lovelace' },
    children: (
      <LumenLayout
        crumbs={[{ label: 'Home' }]}
        cards={[
          {
            id: 'today',
            title: 'Today',
            children: (
              <div className="flex flex-col gap-3">
                <TileRow>
                  <Tile label="Revenue" value="$41,220" caption="so far today" />
                  <Tile label="Orders" value="612" />
                  <Tile label="Stores open" value="11 of 12" />
                </TileRow>
                <NoteLine icon={InfoIcon} title="Faro opens late." note="Back at 11:00." />
              </div>
            ),
          },
        ]}
      />
    ),
  },
} satisfies Meta<typeof LumenShell>;

export default meta;
export const Shell: StoryObj<typeof meta> = {};

/** Many apps' Settings groups: the dialog's section list scrolls under its pinned search (press Ctrl+,). */
export const LongSettings: StoryObj<typeof meta> = {
  args: {
    settingsGroups: ['Hub', 'Tools', 'Career', 'Cards', 'Recipes', 'Watch', 'Assistant'].map(
      (label) => ({
        label,
        sections: ['Connection', 'Alerts', 'Model providers', 'Allowance'].map((title) => ({
          id: `${label}-${title}`.toLowerCase().replace(/\W+/g, '-'),
          title,
          icon: SettingsIcon,
          description: `${title} for ${label}.`,
          content: <p className="text-sm text-muted-foreground">{title}</p>,
        })),
      }),
    ),
  },
};
