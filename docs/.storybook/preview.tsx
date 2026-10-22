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
    withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
  ],
  parameters: {
    layout: 'padded',
    controls: { expanded: true, sort: 'requiredFirst' },
    docs: { codePanel: true },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Install',
          'Frame',
          'Pages and views',
          'Pickers and panels',
          'Charts',
          'Code',
          'Feedback',
          'Reference',
          'Base parts',
        ],
      },
    },
  },
};

export default preview;
