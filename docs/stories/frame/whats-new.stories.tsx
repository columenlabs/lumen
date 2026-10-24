import { WhatsNew } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';

/** Two sample releases: one with a few notes (a flat list), one where an app has three (split). */
const releases = [
  {
    tag: 'v1.4.2',
    published_at: '2026-10-23T22:00:00Z',
    takeaways: [
      {
        text: '**Date fields step one day**: ‹ › beside any date step it a day.',
        types: ['feature'],
      },
      {
        text: '**Store list sorts by sales**: the Stores page sorts by this week.',
        types: ['feature'],
        apps: ['stores'],
      },
      {
        text: '**Reports load faster**: the month view reads half the rows.',
        types: ['performance'],
        apps: ['reports'],
      },
    ],
  },
  {
    tag: 'v1.4.1',
    published_at: '2026-10-22T22:00:00Z',
    takeaways: [
      {
        text: '**Stock counts show missed days**: a row for every day, marked Missed.',
        types: ['feature'],
        apps: ['stores'],
      },
      {
        text: '**Opening hours keep the time zone**: saved in the store’s own zone.',
        types: ['fix'],
        apps: ['stores'],
      },
      {
        text: '**Shared stock lines**: a store’s stock shows in its report.',
        types: ['feature'],
        apps: ['stores', 'reports'],
      },
      { text: '**Sign-in returns to the page you were on**.', types: ['fix'] },
    ],
  },
];

const api = '/whats-new-sample';
const real = globalThis.fetch;
globalThis.fetch = (input, init) =>
  String(input).startsWith(api)
    ? Promise.resolve(new Response(JSON.stringify({ releases })))
    : real(input, init);

const meta = {
  title: 'App shell/WhatsNew',
  component: WhatsNew,
  parameters: {
    docs: {
      description: {
        component:
          "The status bar's version, which opens each release's Key takeaways. With `apps` each takeaway shows the chip of the app it is about (`everyone` for none), and a release where one app has three or more is split into one sub-section per app.",
      },
    },
  },
  args: { api, apps: { stores: 'Stores', reports: 'Reports' } },
} satisfies Meta<typeof WhatsNew>;

export default meta;

export const AppChips: StoryObj<typeof meta> = {};
