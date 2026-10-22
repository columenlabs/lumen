// Writes dist/docs/llms.txt for coding agents from what the Storybook build just made: every
// component's props (manifests/components.json), its usage snippets, and the reference pages
// (manifests/docs.json). Nothing here is written by hand, so it stays as current as the build.
// It first strips the build machine's own folder from every file: docgen records absolute paths.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
const out = join(root, 'dist/docs');
const repo = fileURLToPath(new URL('../..', import.meta.url));

for (const file of (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) =>
    statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)],
  );
})(out).filter((f) => /\.(js|json|html)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (text.includes(repo)) writeFileSync(file, text.replaceAll(repo, ''));
}
const site = 'https://lumen-ui.columenlabs.com/docs';
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

const intro = docs['introduction--docs']?.content ?? '';
const lede = intro.match(/^# Lumen\n\n(.+)$/m)?.[1] ?? '';
const parts: string[] = [
  '# Lumen',
  '',
  `> ${lede}`,
  '',
  'Lumen is built on shadcn/ui (Radix UI, Base UI, Tailwind CSS). Install: `bun add @columenlabs/lumen-ui @columenlabs/lumen-ui-types` (one exact version for both), then import `@columenlabs/lumen-ui/theme.css` after Tailwind.',
  '',
  `- Docs: ${site}/`,
  `- Component manifest (JSON, props and snippets): ${site}/manifests/components.json`,
  `- Install guide: ${site}/?path=/docs/install--docs`,
  '- Prefer LumenSelector for every picker, LumenDrawer for side panels, LumenTabs for tabs and LumenConfirm for destructive confirms over the raw ui/* parts.',
  '',
  '## Components',
  '',
];

for (const c of Object.values(components)) {
  const p = props(c);
  if (!p && !c.stories?.length) continue;
  parts.push(`### ${c.name}`, '', summary(c), '', `Docs: ${site}/?path=/docs/${c.id}--docs`, '');
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
  '## Reference',
  '',
  'Parts that need an app behind them; their pages list each prop.',
  '',
);
for (const d of Object.values(docs)) {
  if (!d.id.startsWith('reference-')) continue;
  parts.push(
    `### ${d.title.replace(/^Reference\//, '')}`,
    '',
    `Docs: ${site}/?path=/docs/${d.id}`,
    '',
    referenceParts(d),
    '',
  );
}

writeFileSync(join(out, 'llms.txt'), `${parts.join('\n').trim()}\n`);
console.log(`llms.txt: ${Object.keys(components).length} components`);
