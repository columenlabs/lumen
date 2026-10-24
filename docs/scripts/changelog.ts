// Writes stories/changelog/releases.json from the repo's GitHub releases: each release's tag, date
// and its Key takeaways (the notes lumen-ship release writes on every publish). Run before the
// Storybook build so every deploy carries the newest notes. GitHub's public API needs no token; if
// it can't be reached the committed file stays as it is and the build goes on.
import { writeFileSync } from 'node:fs';

const REPO = 'columenlabs/lumen';
const OUT = new URL('../stories/changelog/releases.json', import.meta.url);
const KINDS = ['feature', 'improvement', 'fix', 'performance', 'security'] as const;

interface GhRelease {
  tag_name: string;
  published_at: string;
  draft: boolean;
  body: string | null;
}

/** `- [Fix] **Title**: body` lines under `## Key takeaways`. */
function takeaways(body: string) {
  const start = body.search(/^## Key takeaways\s*$/m);
  if (start < 0) return [];
  const rest = body.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((l) => l.startsWith('- '))
    .map((l) => {
      let line = l.slice(2).trim();
      const kinds: string[] = [];
      for (let m = line.match(/^\[(\w+)\]\s*/); m; m = line.match(/^\[(\w+)\]\s*/)) {
        const k = (m[1] ?? '').toLowerCase();
        if ((KINDS as readonly string[]).includes(k)) kinds.push(k);
        line = line.slice(m[0].length);
      }
      const titled = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
      return titled
        ? { kinds, title: titled[1] ?? '', body: titled[2] ?? '' }
        : { kinds, title: '', body: line };
    });
}

async function main() {
  const all: GhRelease[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`,
      {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'lumen-docs' },
      },
    );
    if (!r.ok) throw new Error(`GitHub releases ${r.status}`);
    const batch = (await r.json()) as GhRelease[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const releases = all
    .filter((r) => !r.draft)
    // Newest version first (some older tags were republished later, so dates don't order them).
    .sort((a, b) => b.tag_name.localeCompare(a.tag_name, 'en', { numeric: true }))
    .map((r) => ({ tag: r.tag_name, date: r.published_at, takeaways: takeaways(r.body ?? '') }));
  writeFileSync(OUT, `${JSON.stringify(releases, null, 2)}\n`);
  console.log(`changelog: ${releases.length} releases`);
}

main().catch((e) => console.warn(`changelog: kept the committed notes (${(e as Error).message})`));
