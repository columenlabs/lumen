// What's new (in Lumen for
// every app): the version in the status bar opens the release notes, newest
// first, each release's Key takeaways only. An app turns it on with LumenShell's `releases`, its
// releases API (`GET ?limit=&before=` answering `{releases}`), which leaves out what the person can't
// open; a host that answers 404 (self-host an app) keeps the version hidden.
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Markdown from 'react-markdown';
import { DrawerSection } from './drawer-section';
import { LumenDrawer } from './lumen-drawer';
import { usePrefs } from './prefs';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type ReleaseType = 'feature' | 'improvement' | 'fix' | 'performance' | 'security';

interface Release {
  tag: string;
  published_at: string;
  takeaways: { text: string; types: ReleaseType[] }[];
}

/** Each takeaway's type chips, in this order, in the shell's status tones. */
const TYPES: Record<
  ReleaseType,
  { label: string; variant: 'info' | 'success' | 'warning' | 'secondary' | 'destructive' }
> = {
  feature: { label: 'Feature', variant: 'info' },
  improvement: { label: 'Improvement', variant: 'success' },
  fix: { label: 'Fix', variant: 'warning' },
  performance: { label: 'Performance', variant: 'secondary' },
  security: { label: 'Security', variant: 'destructive' },
};
const ORDER = Object.keys(TYPES) as ReleaseType[];

const PAGE = 20;

async function page(api: string, before: string | null): Promise<Release[] | null> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (before) q.set('before', before);
  const r = await fetch(`${api}?${q}`, { credentials: 'include' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`releases ${r.status}`);
  return ((await r.json()) as { releases: Release[] }).releases;
}

export function WhatsNew({ api }: { api: string }) {
  const [open, setOpen] = useState(false);
  const { timeZone } = usePrefs();
  const q = useInfiniteQuery({
    queryKey: ['edgeshell', 'releases', api],
    queryFn: ({ pageParam }) => page(api, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last && last.length === PAGE ? last.at(-1)?.published_at : undefined,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const releases = q.data?.pages.flatMap((p) => p ?? []) ?? [];
  const latest = releases[0];
  if (!latest) return null;
  const day = (at: string) =>
    new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="num h-6 px-1.5 text-muted-foreground text-xs"
        onClick={() => setOpen(true)}
        title="What's new"
      >
        {latest.tag}
      </Button>
      <LumenDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="What's new"
        description="Key takeaways of each release, newest first"
        footerStart={`${releases.length} releases`}
        footer={
          <>
            {q.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={q.isFetchingNextPage}
                onClick={() => q.fetchNextPage()}
              >
                Show more
              </Button>
            )}
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        {releases.map((r, i) => (
          <DrawerSection key={r.tag} title={r.tag} hint={day(r.published_at)} defaultOpen={i === 0}>
            {r.takeaways.length ? (
              <ul className="list-disc space-y-1.5 py-1 pr-1 pl-5 text-sm leading-relaxed [&_strong]:font-semibold">
                {r.takeaways.map((t) => (
                  <li key={t.text}>
                    {t.types.length > 0 && (
                      <span className="mr-1.5 inline-flex flex-wrap gap-1 align-middle">
                        {ORDER.filter((k) => t.types.includes(k)).map((k) => (
                          <Badge key={k} variant={TYPES[k].variant} className="px-1.5">
                            {TYPES[k].label}
                          </Badge>
                        ))}
                      </span>
                    )}
                    <Markdown allowedElements={['strong', 'em', 'code']} unwrapDisallowed>
                      {t.text}
                    </Markdown>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 pl-1 text-muted-foreground text-sm">
                Nothing new for you in this one.
              </p>
            )}
          </DrawerSection>
        ))}
      </LumenDrawer>
    </>
  );
}
