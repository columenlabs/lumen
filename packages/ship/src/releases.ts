// What's new: the releases a repo's `lumen-ship release` wrote into its changelog JSON, served the
// way @columenlabs/lumen-ui's WhatsNew reads them (`GET ?limit=&before=` answering `{releases}`).
// No framework: an app mounts `listReleases` on whatever router it runs.

/** A takeaway's coloured chips in What's new, one or more. */
export type ReleaseType = 'feature' | 'improvement' | 'fix' | 'performance' | 'security';

export interface Takeaway {
  /** One Key takeaways bullet, markdown, its tags taken off. */
  text: string;
  types: ReleaseType[];
  /** The apps it is about, from `changelog.apps` in lumen-ship.json; left out: everyone's. */
  apps?: string[];
}

export interface Release {
  tag: string;
  /** ISO time; pages are cut by it, newest first. */
  published_at: string;
  takeaways: Takeaway[];
}

export interface ListReleasesOptions {
  /** How many, 1 to 50; 20 when left out or not a number. */
  limit?: number | string | null;
  /** Only releases published before this ISO time (the last one of the page before). */
  before?: string | null;
  /** Keeps a takeaway about some apps only for people who may open one of them. */
  canSee?: (apps: string[]) => boolean;
}

/** One page of releases, newest first. A release left with no takeaways keeps its tag. */
export function listReleases(releases: Release[], options: ListReleasesOptions = {}): Release[] {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
  const { before, canSee } = options;
  const list = (before ? releases.filter((r) => r.published_at < before) : releases).slice(
    0,
    limit,
  );
  if (!canSee) return list;
  return list.map((r) => ({
    ...r,
    takeaways: r.takeaways.filter((t) => !t.apps?.length || canSee(t.apps)),
  }));
}

/** The response headers What's new expects: private, and cached five minutes. */
export const RELEASES_HEADERS = { 'cache-control': 'private, max-age=300' } as const;
