// Writes the files coding agents read at the site's root, from the READMEs and what the Storybook
// build just made: /llms.txt (the index), /<package>.md (each package's README) and /llms-full.txt
// (every README, then every component's props, usage snippet and the reference pages from
// manifests/components.json and manifests/docs.json). Nothing here is written by hand, so it stays
// as current as the build. It first strips the build machine's own folder from every file: docgen
// records absolute paths.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Prop = {
  name: string;
  required: boolean;
  description: string;
  defaultValue: { value: unknown } | null;
  type: { name: string };
};
type Component = {
  id: string;
  name: string;
  path: string;
  description?: string;
  import?: string;
  reactDocgenTypescript?: { description?: string; props?: Record<string, Prop> };
  stories?: { id: string; name: string; snippet?: string }[];
};
type Doc = { id: string; title: string; content: string };

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const out = join(dist, 'docs');
const repo = fileURLToPath(new URL('../..', import.meta.url));

for (const file of (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) =>
    statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)],
  );
})(out).filter((f) => /\.(js|json|html)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (text.includes(repo)) writeFileSync(file, text.replaceAll(repo, ''));
}
const host = 'https://lumen.columenlabs.com';
const site = `${host}/docs`;
const github = 'https://github.com/columenlabs/lumen';
const components: Record<string, Component> = JSON.parse(
  readFileSync(join(out, 'manifests/components.json'), 'utf8'),
).components;
const docs: Record<string, Doc> = JSON.parse(
  readFileSync(join(out, 'manifests/docs.json'), 'utf8'),
).docs;

// A story file's own summary (`docs.description.component`) reads better than the source's JSDoc.
function summary(c: Component): string {
  try {
    const src = readFileSync(join(root, c.path), 'utf8');
    const m = src.match(/component:\s*\n?\s*(['"`])([\s\S]*?)\1,?\s*\n/);
    if (m?.[2]) return m[2].replace(/\s+/g, ' ').trim();
  } catch {}
  return (c.reactDocgenTypescript?.description || c.description || '').trim();
}

function props(c: Component): string {
  const all = Object.values(c.reactDocgenTypescript?.props ?? {});
  if (!all.length) return '';
  all.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
  return all
    .map((p) => {
      const def = p.defaultValue?.value != null ? ` = ${String(p.defaultValue.value)}` : '';
      const desc = p.description ? ` — ${p.description.replace(/\s+/g, ' ')}` : '';
      return `- \`${p.name}${p.required ? '' : '?'}: ${p.type.name}\`${def}${desc}`;
    })
    .join('\n');
}

// A reference page lists parts as `## Name` then one line; keep those pairs.
function referenceParts(d: Doc): string {
  return [...d.content.matchAll(/^## (\w+)\n\n(.+)$/gm)]
    .map(([, n, line]) => `- ${n}: ${line}`)
    .join('\n');
}

// A README's relative links and images point into the repo; served alone they need its address.
function absolute(md: string, dir: string): string {
  return md.replace(/(\]\(|src=")(?!https?:|#|mailto:)([^)"]+)/g, (_, a, path) => {
    const url = new URL(path, `${github}/blob/main/${dir}`).href;
    return `${a}${a === 'src="' ? url.replace('/blob/', '/raw/') : url}`;
  });
}

// Every package with a README, by name; a new package shows up by itself.
const packages = readdirSync(join(repo, 'packages'))
  .sort()
  .filter((name) => statSync(join(repo, 'packages', name, 'README.md'), { throwIfNoEntry: false }))
  .map((name) => {
    const md = absolute(
      readFileSync(join(repo, 'packages', name, 'README.md'), 'utf8'),
      `packages/${name}/`,
    );
    const title = md.match(/^# (.+)$/m)?.[1] ?? name;
    const lede = md.match(/^# .+\n\n(.+)$/m)?.[1] ?? '';
    return { name, md, title, lede };
  });
const readme = absolute(readFileSync(join(repo, 'README.md'), 'utf8'), '');
for (const p of packages) writeFileSync(join(dist, `${p.name}.md`), p.md);

// How to use each part (docs/parts): served at /parts/<name>.md, listed in the index and put first
// in llms-full.txt, since an agent should read the rules before the props.
const partsDir = join(repo, 'docs/parts');
mkdirSync(join(dist, 'parts'), { recursive: true });
const guides = readdirSync(partsDir)
  .filter((f) => f.endsWith('.md'))
  .sort((a, b) => Number(b === 'README.md') - Number(a === 'README.md') || a.localeCompare(b))
  .map((file) => {
    const md = absolute(readFileSync(join(partsDir, file), 'utf8'), 'docs/parts/');
    writeFileSync(join(dist, 'parts', file), md);
    return { file, md, title: md.match(/^# (.+)$/m)?.[1] ?? file };
  });

const index = [
  '# Lumen',
  '',
  "> Columen Labs' shared building blocks for apps, published to npm as `@columenlabs/lumen-<name>`: a React component system for data apps (`lumen-ui`) and its view model (`lumen-ui-types`), with shared backend packages joining as they move out of the apps that run them. Every package ships at one version from one release; pin the same exact version for all of them.",
  '',
  'Lumen is MIT and names no product: an app passes its names in through `configureLumen` and its data domains through `registerDomains` (`@columenlabs/lumen-ui-types/registry`). Use Bun (`bun add`).',
  '',
  '## Packages',
  '',
  ...packages.map(
    (p) =>
      `- [${p.title}](${host}/${p.name}.md): ${p.lede.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`,
  ),
  '',
  '## How to use the parts',
  '',
  'Read the page for a part before you add or change it in an app: when to use it, its anatomy, do and do not, and the lint rule that checks it.',
  '',
  ...guides.map((g) => `- [${g.title}](${host}/parts/${g.file})`),
  '',
  '## Docs',
  '',
  `- [Everything in one file](${host}/llms-full.txt): every README, then every component's props and an example`,
  `- [Live docs](${site}/): Storybook, every component on sample data`,
  `- [Component manifest](${site}/manifests/components.json): JSON, props and snippets`,
  `- [Source](${github}): one repo, \`packages/<name>\` per package`,
  `- [Releases](${github}/releases): what changed in each version`,
  '',
];
writeFileSync(join(dist, 'llms.txt'), `${index.join('\n')}\n`);

const parts: string[] = [
  '# Lumen',
  '',
  readme
    .replace(/^[\s\S]*?## Packages/m, '## Packages')
    .replace(/<\/?(?:div|img|sub|br)\b[^>]*>/g, '')
    .replace(/^\| Edit layout \| Edit widget \|\n\|---\|---\|\n\|(?:\s*\|)+\n/m, '')
    .trim(),
  '',
  ...guides.flatMap((g) => [g.md.replace(/^# /m, '# How to use: ').trim(), '']),
  ...packages.flatMap((p) => [p.md.replace(/^# /m, '# Package: ').trim(), '']),
  '# Components',
  '',
  'Lumen is built on shadcn/ui (Radix UI, Base UI, Tailwind CSS). Install: `bun add @columenlabs/lumen-ui @columenlabs/lumen-ui-types` (one exact version for both), then import `@columenlabs/lumen-ui/theme.css` after Tailwind.',
  '',
  '- Prefer LumenSelector for every picker, LumenDrawer for side panels, LumenTabs for tabs and LumenConfirm for destructive confirms over the raw ui/* parts.',
  '',
];

for (const c of Object.values(components)) {
  const p = props(c);
  if (!p && !c.stories?.length) continue;
  parts.push(`## ${c.name}`, '', summary(c), '', `Docs: ${site}/?path=/docs/${c.id}--docs`, '');
  const kit = c.import
    ?.split('\n')
    .filter((l) => l.includes("'@columenlabs/"))
    .join('\n');
  if (kit) parts.push('```tsx', kit, '```', '');
  if (p) parts.push('Props:', '', p, '');
  const ex = c.stories?.find((s) => s.snippet)?.snippet;
  if (ex) parts.push('Example:', '', '```tsx', ex, '```', '');
}

parts.push(
  '# Reference',
  '',
  'Parts that need an app behind them; their pages list each prop.',
  '',
);
for (const d of Object.values(docs)) {
  if (!d.id.startsWith('reference-')) continue;
  parts.push(
    `## ${d.title.replace(/^Reference\//, '')}`,
    '',
    `Docs: ${site}/?path=/docs/${d.id}`,
    '',
    referenceParts(d),
    '',
  );
}

writeFileSync(join(dist, 'llms-full.txt'), `${parts.join('\n').trim()}\n`);
console.log(
  `llms.txt, llms-full.txt: ${packages.length} packages, ${Object.keys(components).length} components`,
);
