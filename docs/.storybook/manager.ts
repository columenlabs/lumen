// The docs' own name, theme and sidebar icons. Each top-level section and group gets its own icon so
// the three levels (App shell, Blocks, Components) read at a glance.
import {
  AppWindowIcon,
  BookOpenIcon,
  BoxesIcon,
  ChartLineIcon,
  CodeIcon,
  ComponentIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MessageSquareWarningIcon,
  MousePointerClickIcon,
  RocketIcon,
  ShapesIcon,
  TableIcon,
} from 'lucide-react';
import React, { type ComponentType } from 'react';
import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  'Get started': RocketIcon,
  'App shell': AppWindowIcon,
  Blocks: BoxesIcon,
  Components: ComponentIcon,
  Changelog: HistoryIcon,
  Reference: LibraryIcon,
  'Pages and views': TableIcon,
  'Pickers and panels': MousePointerClickIcon,
  Charts: ChartLineIcon,
  Code: CodeIcon,
  Feedback: MessageSquareWarningIcon,
  'Base parts': ShapesIcon,
  'Page layout': LayoutTemplateIcon,
  Introduction: BookOpenIcon,
};

addons.setConfig({
  theme: create({
    base: 'dark',
    brandTitle: 'Lumen',
    brandUrl: 'https://github.com/columenlabs/lumen-ui',
    appBg: '#0b0f17',
    appContentBg: '#0b0f17',
    barBg: '#0b0f17',
    colorSecondary: '#5b8cff',
    fontBase: '"Inter", ui-sans-serif, system-ui, sans-serif',
  }),
  sidebar: {
    renderLabel: (item) => {
      const Icon = ICONS[item.name];
      if (!Icon) return item.name;
      // The manager bundle uses the classic JSX runtime, so build the label without JSX.
      return React.createElement(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        React.createElement(Icon, { size: 14, strokeWidth: 1.75 }),
        item.name,
      );
    },
  },
});
