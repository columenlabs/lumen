// What's new (in Lumen for
// every app): the version in the status bar opens the release notes, newest
// first, each release's Key takeaways only. An app turns it on with LumenShell's `releases`, its
// releases API (`GET ?limit=&before=` answering `{releases}`), which leaves out what the person can't
// open; a host that answers 404 (self-host an app) keeps the version hidden. With `apps`, each
// takeaway carries a chip of the app it is about (`apps` on the takeaway; none: everyone), and a
// release where one app has `GROUP_AT` or more is split into one sub-section per app.
import { useInfiniteQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
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
  takeaways: Takeaway[];
}

interface Takeaway {
  text: string;
  types: ReleaseType[];
  /** The apps it is about, by id; left out: a change everyone sees. */
  apps?: string[];
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

/** A release is split by app once one app has this many takeaways in it. */
const GROUP_AT = 3;
/** The group of takeaways about no one app. */
const EVERYONE = '';

async function page(api: string, before: string | null): Promise<Release[] | null> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (before) q.set('before', before);
  const r = await fetch(`${api}?${q}`, { credentials: 'include' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`releases ${r.status}`);
  return ((await r.json()) as { releases: Release[] }).releases;
}

export function WhatsNew({
  api,
  apps,
  everyone = 'Global',
}: {
  api: string;
  /** Each app's chip label by id, in the order groups list them; left out: no app chips. */
  apps?: Record<string, ReactNode>;
  /** The chip of a takeaway about no one app. */
  everyone?: string;
}) {
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
              <Notes takeaways={r.takeaways} apps={apps} everyone={everyone} />
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

/** One release's takeaways: a flat list, or one sub-section per app once one app has many. */
function Notes({
  takeaways,
  apps,
  everyone,
}: {
  takeaways: Takeaway[];
  apps?: Record<string, ReactNode>;
  everyone: string;
}) {
  const appOf = (t: Takeaway) => t.apps?.find((a) => apps?.[a] != null) ?? EVERYONE;
  const groups = new Map<string, Takeaway[]>();
  for (const t of takeaways) {
    const k = apps ? appOf(t) : EVERYONE;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const split = apps && groups.size > 1 && [...groups.values()].some((g) => g.length >= GROUP_AT);
  if (!split) return <List takeaways={takeaways} apps={apps} everyone={everyone} />;
  const order = Object.keys(apps);
  const rank = (k: string) => (k === EVERYONE ? order.length : order.indexOf(k));
  const keys = [...groups.keys()].sort(
    (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || rank(a) - rank(b),
  );
  return (
    <div className="space-y-2 py-1">
      {keys.map((k) => (
        <div key={k || 'everyone'}>
          <div className="flex items-center gap-1.5 pl-1 text-muted-foreground text-xs">
            <AppChip label={k ? apps[k] : everyone} />
            <span className="num">{groups.get(k)?.length}</span>
          </div>
          <List takeaways={groups.get(k) ?? []} apps={apps} everyone={everyone} group={k} />
        </div>
      ))}
    </div>
  );
}

/** Takeaways as bullets: app chips (bar the group's own), then type chips, then the text. */
function List({
  takeaways,
  apps,
  everyone,
  group,
}: {
  takeaways: Takeaway[];
  apps?: Record<string, ReactNode>;
  everyone: string;
  /** The sub-section's app, whose chip each row leaves out. */
  group?: string;
}) {
  return (
    <ul className="list-disc space-y-1.5 py-1 pr-1 pl-5 text-sm leading-relaxed [&_strong]:font-semibold">
      {takeaways.map((t) => {
        const own = (t.apps ?? []).filter((a) => apps?.[a] != null);
        const chips = apps
          ? (own.length ? own : [EVERYONE]).filter((a) => group === undefined || a !== group)
          : [];
        return (
          <li key={t.text}>
            {(chips.length > 0 || t.types.length > 0) && (
              <span className="mr-1.5 inline-flex flex-wrap gap-1 align-middle">
                {chips.map((a) => (
                  <AppChip key={a || 'everyone'} label={a ? apps?.[a] : everyone} />
                ))}
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
        );
      })}
    </ul>
  );
}

function AppChip({ label }: { label: ReactNode }) {
  return (
    <Badge variant="outline" className="px-1.5 font-semibold">
      {label}
    </Badge>
  );
}
