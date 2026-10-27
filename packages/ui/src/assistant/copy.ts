// A chat as Markdown, for Copy chat and each turn's copy icon: every message, tool line and card as
// it shows, so a chat can be pasted into an issue, a doc or another agent.
import type { ChatItem } from '@columenlabs/lumen-ui-types/assistant';
import { lumenToast } from '../lumen-toast';

/** The whole chat, its title as the heading. */
export function chatMarkdown(title: string, items: ChatItem[], name: string): string {
  return [`# ${title || `${name} chat`}`, ...items.map((i) => itemMarkdown(i, 2, name))]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

/** One turn: a message and everything the assistant did for it. */
export function turnMarkdown(items: ChatItem[], name: string): string {
  return `${items
    .map((i) => itemMarkdown(i, 2, name))
    .filter(Boolean)
    .join('\n\n')}\n`;
}

/** Splits a chat into turns: each starts at a message from the person. */
export function chatTurns<T extends { kind: string }>(items: T[]): { from: number; items: T[] }[] {
  const starts = items.flatMap((x, i) => (x.kind === 'user' || i === 0 ? [i] : []));
  return starts.map((from, t) => ({
    from,
    items: items.slice(from, starts[t + 1] ?? items.length),
  }));
}

/** Puts Markdown on the clipboard and says so. */
export function copyMarkdown(md: string, what: string) {
  void navigator.clipboard.writeText(md).then(
    () => lumenToast(`${what} copied as Markdown`),
    () => lumenToast.error(`Couldn't copy the ${what.toLowerCase()}`),
  );
}

const fence = (body: string) => {
  const ticks = body.includes('```') ? '````' : '```';
  return `${ticks}json\n${body}\n${ticks}`;
};

function itemMarkdown(i: ChatItem, depth: number, name: string): string {
  const h = '#'.repeat(Math.min(depth, 6));
  switch (i.kind) {
    case 'user': {
      const refs = i.refs?.length
        ? `\n\nPointing at: ${i.refs.map((r) => r.label).join(', ')}`
        : '';
      return `${h} You\n\n${i.text}${refs}`;
    }
    case 'text':
      return `${h} ${name}\n\n${i.text}`;
    case 'step': {
      const facts = [
        i.rows !== undefined ? `${i.rows} rows` : '',
        `${(i.ms / 1000).toFixed(1)} s`,
        i.write ? i.write.status : '',
      ].filter(Boolean);
      return `**${i.ok ? 'Tool' : 'Failed'}: ${i.title}** (${facts.join(', ')})${i.error ? `\n\nError: ${i.error}` : ''}`;
    }
    case 'draft':
      return [
        `**Card: ${i.title}** (${i.status})`,
        fence(JSON.stringify(i.args, null, 2)),
        i.error ? `Error: ${i.error}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    case 'handoff':
      return [
        `${h} ${i.label} (${i.why})`,
        `Task: ${i.task}`,
        ...i.items.map((x) => itemMarkdown(x, depth + 1, i.label)),
      ].join('\n\n');
    case 'advice':
      return `_${i.error ? 'Could not ask' : 'Asked'} ${i.label} for advice._`;
    case 'compacted':
      return '_Compacted._';
    case 'stopped':
      return '_Stopped._';
    case 'error':
      return `**Error${i.code ? ` (${i.code})` : ''}:** ${i.text}`;
  }
}
