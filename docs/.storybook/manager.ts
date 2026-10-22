// The docs' own name in the sidebar and the browser tab.
import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'Lumen',
    brandUrl: 'https://github.com/columenlabs/lumen-ui',
  }),
});
