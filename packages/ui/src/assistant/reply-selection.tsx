// Reply to a piece of the chat: text selected inside one message (the person's or the assistant's)
// gets a small bar above it, Reply and Copy. Reply puts the selection over the composer as a quote
// (`composeAssistant`), which goes with the next message.
import { ASSISTANT_QUOTE_MAX, type AssistantQuote } from '@columenlabs/lumen-ui-types/assistant';
import { CopyIcon, ReplyIcon } from 'lucide-react';
import { type RefObject, useEffect, useState } from 'react';
import { IconButton } from '../icon-button';
import { lumenToast } from '../lumen-toast';
import { composeAssistant } from './sources';

/** The bar's size, to keep it inside the chat's box. */
const BAR_W = 72;
const BAR_H = 40;

interface Picked {
  quote: AssistantQuote;
  top: number;
  left: number;
}

/** The message (`data-chat-from`) a node sits in, when it is inside `box`. */
function messageOf(node: Node | null, box: HTMLElement): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const m = el?.closest<HTMLElement>('[data-chat-from]') ?? null;
  return m && box.contains(m) ? m : null;
}

/** The selection as a quote and where its bar goes in `box`, or null when it is not one message's text. */
function pickedIn(box: HTMLElement): Picked | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const from = messageOf(sel.anchorNode, box);
  if (!from || from !== messageOf(sel.focusNode, box)) return null;
  const text = sel.toString().trim().slice(0, ASSISTANT_QUOTE_MAX);
  if (!text) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const above = r.top - b.top - BAR_H - 4;
  const top = (above >= 0 ? above : r.bottom - b.top + 4) + box.scrollTop;
  const mid = r.left - b.left + r.width / 2 - BAR_W / 2;
  const left = Math.max(4, Math.min(mid, b.width - BAR_W - 4));
  return {
    quote: { text, from: from.dataset.chatFrom === 'user' ? 'user' : 'assistant' },
    top,
    left,
  };
}

/**
 * The Reply bar over selected chat text. `box` is the chat's scrolling box, positioned; the bar
 * sits in it, above the selection (below it when the top is out of view).
 */
export function ReplyToSelection({ box }: { box: RefObject<HTMLElement | null> }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = box.current;
        setPicked(el ? pickedIn(el) : null);
      });
    };
    document.addEventListener('selectionchange', read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', read);
    };
  }, [box]);
  if (!picked) return null;
  const done = () => {
    document.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  return (
    <div
      role="toolbar"
      aria-label="Selected text"
      className="absolute z-10 flex gap-0.5 rounded-lg border bg-popover p-0.5 shadow-md"
      style={{ top: picked.top, left: picked.left }}
      // A press on the bar keeps the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <IconButton
        icon={ReplyIcon}
        label="Reply"
        onClick={() => {
          composeAssistant({ quote: picked.quote });
          done();
        }}
      />
      <IconButton
        icon={CopyIcon}
        label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(picked.quote.text).then(
            () => lumenToast.success('Copied'),
            () => lumenToast.error("Couldn't copy. Copy it with your keyboard instead."),
          );
          done();
        }}
      />
    </div>
  );
}
