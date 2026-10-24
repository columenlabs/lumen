import type { StorybookConfig } from '@storybook/react-vite';
// The docs site: one Storybook over the kit's source. `bun run build` writes it to dist/docs, which
// the Worker in wrangler.jsonc serves at /docs. Props tables come from the source through
// react-docgen-typescript, on the TypeScript 5 this workspace pins (the kit's TypeScript 7 has no
// compiler API).
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes', '@storybook/addon-mcp'],
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      // Document the kit's own source, read through the kit's tsconfig.
      tsconfigPath: '../packages/ui/tsconfig.json',
      include: ['../packages/ui/src/**/*.tsx'],
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      // Only the kit's own props: leave out the DOM attributes every element inherits.
      propFilter: (prop) => !prop.parent || !/node_modules/.test(prop.parent.fileName),
    },
  },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
  viteFinal: (vite) => ({ ...vite, plugins: [...(vite.plugins ?? []), tailwindcss()] }),
};

export default config;
