import { TooltipProvider } from '@columenlabs/lumen-ui/ui/tooltip';
import { withThemeByClassName } from '@storybook/addon-themes';
import type { Decorator, Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { create } from 'storybook/theming';
import './preview.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Parts with links or page state need a router, a query client and tooltips, as they have in an app.
const withProviders: Decorator = (Story) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Story /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

const preview: Preview = {
  tags: ['autodocs'],
  decorators: [
    withProviders,
    withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'dark' }),
  ],
  parameters: {
    layout: 'padded',
    controls: { expanded: true, sort: 'requiredFirst' },
    docs: {
      codePanel: true,
      // The docs pages match the dark manager around them.
      theme: create({
        base: 'dark',
        appBg: '#0b0f17',
        appContentBg: '#0b0f17',
        colorSecondary: '#5b8cff',
        fontBase: '"Inter", ui-sans-serif, system-ui, sans-serif',
      }),
    },
    options: {
      storySort: {
        order: [
          'Get started',
          ['Introduction', 'Install'],
          'App shell',
          ['Lumen in play', 'LumenShell', 'Frame parts'],
          'Blocks',
          [
            'Sign-in',
            'Tabs',
            'Page layout',
            'Edit layout',
            'Edit widget',
            'Editable widget',
            'Settings',
            'Assistant and workspaces',
          ],
          'Components',
          ['Pages and views', 'Pickers and panels', 'Charts', 'Code', 'Feedback', 'Base parts'],
          'Changelog',
          'Reference',
        ],
      },
    },
  },
};

export default preview;
