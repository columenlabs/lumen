/**
 * An assistant answer as Markdown: paragraphs, lists, code and links, and GitHub tables drawn as
 * the kit's table (ui/table). Loaded with the first answer (lazy-part.tsx), so react-markdown and
 * remark-gfm never ride in an app's first page.
 *
 * A table keeps the kit's rules: every row is one line, a long value ends in an ellipsis with the
 * whole text in its hover, a column of numbers right-aligns on one edge (header included) in
 * tabular figures, and a table wider than the chat scrolls sideways inside its own box.
 */
import type { ComponentProps, ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

/** The parts of a hast node this file reads (hast's own types are not a dependency of the kit). */
interface HNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

const ALLOWED = [
  'p',
  'strong',
  'em',
  'del',
  'code',
  'ul',
  'ol',
  'li',
  'a',
  'pre',
  'br',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

// A number, with an optional sign, currency, thousands, decimals and a short unit (12, −3.5%,
// $1,204.10, 2.1×, 4.2K). A dash or an empty cell does not decide a column either way.
const NUMBER = /^[−+\-]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|×|x|[KMBkmb])?$/;
const BLANK = /^(|—|–|-|n\/a)$/i;

function text(node: HNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(text).join('');
}

const cells = (row: HNode) =>
  (row.children ?? []).filter((c) => c.tagName === 'td' || c.tagName === 'th');
const rows = (section: HNode | undefined) =>
  (section?.children ?? []).filter((c) => c.tagName === 'tr');

/**
 * Marks each cell of a column that holds only numbers `dataNum`, so the column right-aligns on
 * one edge, and gives every cell its text as `dataText` for its hover.
 */
function rehypeNumberColumns() {
  const visit = (node: HNode) => {
    if (node.tagName === 'table') {
      const head = node.children?.find((c) => c.tagName === 'thead');
      const body = node.children?.find((c) => c.tagName === 'tbody');
      const bodyRows = rows(body);
      const width = Math.max(0, ...[...rows(head), ...bodyRows].map((r) => cells(r).length));
      const numeric = Array.from({ length: width }, (_, i) => {
        const values = bodyRows.map((r) => text(cells(r)[i] ?? { type: 'root' }).trim());
        const filled = values.filter((v) => !BLANK.test(v));
        return filled.length > 0 && filled.every((v) => NUMBER.test(v));
      });
      for (const r of [...rows(head), ...bodyRows]) {
        cells(r).forEach((c, i) => {
          c.properties = { ...c.properties, dataText: text(c).trim() };
          if (numeric[i]) c.properties.dataNum = '';
        });
      }
      return;
    }
    node.children?.forEach(visit);
  };
  return (tree: HNode) => visit(tree);
}

type CellProps = { children?: ReactNode; 'data-num'?: string; 'data-text'?: string };

// A header keeps the label font; only its edge follows the numbers under it.
const cellClass = (p: CellProps, head = false) =>
  cn(
    'max-w-xs overflow-hidden text-ellipsis',
    p['data-num'] !== undefined && (head ? 'text-right' : 'num text-right'),
  );

const components = {
  table: ({ children }: ComponentProps<'table'>) => (
    <div className="not-prose my-2 rounded-md border">
      <Table className="text-xs">{children}</Table>
    </div>
  ),
  thead: ({ children }: ComponentProps<'thead'>) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }: ComponentProps<'tbody'>) => <TableBody>{children}</TableBody>,
  tr: ({ children }: ComponentProps<'tr'>) => <TableRow>{children}</TableRow>,
  th: (p: CellProps) => (
    <TableHead className={cn(cellClass(p, true), 'text-muted-foreground')} title={p['data-text']}>
      {p.children}
    </TableHead>
  ),
  td: (p: CellProps) => (
    <TableCell className={cellClass(p)} title={p['data-text']}>
      {p.children}
    </TableCell>
  ),
};

export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeNumberColumns]}
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={components}
    >
      {children}
    </Markdown>
  );
}
