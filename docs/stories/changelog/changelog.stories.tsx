// The Changelog: every release's Key takeaways, newest first, in the look of the status bar's What's
// new (type chips, one section per release). releases.json is written by scripts/changelog.ts from
// the GitHub releases on every docs build.
import { DrawerSection } from '@columenlabs/lumen-ui';
import { Badge } from '@columenlabs/lumen-ui/ui/badge';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import releases from './releases.json';

type Kind = 'feature' | 'improvement' | 'fix' | 'performance' | 'security';
const TYPES: Record<
  Kind,
  { label: string; variant: 'info' | 'success' | 'warning' | 'secondary' | 'destructive' }
> = {
  feature: { label: 'Feature', variant: 'info' },
  improvement: { label: 'Improvement', variant: 'success' },
  fix: { label: 'Fix', variant: 'warning' },
  performance: { label: 'Performance', variant: 'secondary' },
  security: { label: 'Security', variant: 'destructive' },
};

/** The notes' `code` spans as inline code; everything else as plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the split never reorders
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Changelog() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight">Changelog</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Every release of Lumen, newest first, with its key takeaways. The full notes are on{' '}
          <a
            className="underline underline-offset-2"
            href="https://github.com/columenlabs/lumen-ui/releases"
          >
            GitHub
          </a>
          .
        </p>
      </div>
      <div className="divide-y rounded-lg border">
        {releases.map((r, i) => (
          <div key={r.tag} className="px-4">
            <DrawerSection title={r.tag} hint={day(r.date)} defaultOpen={i < 3}>
              {r.takeaways.length ? (
                <ul className="space-y-3 py-1 pb-2">
                  {r.takeaways.map((t) => (
                    <li key={t.title + t.body} className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {(t.kinds as Kind[]).map((k) => (
                          <Badge key={k} variant={TYPES[k].variant} className="px-1.5">
                            {TYPES[k].label}
                          </Badge>
                        ))}
                        {t.title && <span className="font-medium text-sm">{inline(t.title)}</span>}
                      </span>
                      <span className="text-muted-foreground text-sm leading-relaxed">
                        {inline(t.body)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-1 pb-2 text-muted-foreground text-sm">No takeaways listed.</p>
              )}
            </DrawerSection>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: 'Changelog/Release notes',
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen' },
  render: () => <Changelog />,
} satisfies Meta;

export default meta;
export const Page: StoryObj<typeof meta> = { name: 'Release notes' };
