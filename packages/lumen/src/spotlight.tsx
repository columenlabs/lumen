// Hover shows the target, or point at the page. An option that stands for something on screen names
// it as its `target`: `card:<id>` for a LumenLayout card, or an app path for a sidebar page.
//
//   spotlight(target, name)  the page's other cards dim and a name tag sits above the card; a
//                            sidebar page gets the sidebar's muted fill. No border, no glow.
//   pointAtCard()            the cards dim, the one under the cursor lights up; a click picks it,
//                            Esc cancels. Works on any LumenLayout card with no per-page setup.
//
// Both drive the DOM directly through data attributes the theme styles: one spotlight at a time.
import { WIDGET_STYLES } from '@columenlabs/lumen-types/views';

export interface CardOnScreen {
  id: string;
  title: string;
  /** `view` for a table card, else the widget's kind (chart, tiles, ...). */
  kind: string;
}

const CARD = '[data-slot="lumen-card"][data-card]';
const cardEl = (id: string) =>
  document.querySelector<HTMLElement>(`${CARD.slice(0, -1)}="${CSS.escape(id)}"]`);
const navEl = (path: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('[data-sidebar="sidebar"] a[href]')].find((a) =>
    new URL(a.href).pathname.replace(/\/$/, '').endsWith(path.replace(/\/$/, '')),
  ) ?? null;

export const cardOf = (el: HTMLElement): CardOnScreen => ({
  id: el.dataset.card ?? '',
  title: el.dataset.cardTitle ?? '',
  kind: el.dataset.cardKind ?? 'table:table',
});

/** The cards on the page now, top to bottom. */
export const cardsOnScreen = (): CardOnScreen[] =>
  [...document.querySelectorAll<HTMLElement>(CARD)].map(cardOf);

let tag: HTMLDivElement | null = null;
let lit: HTMLElement | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

function clear() {
  clearTimeout(scrollTimer);
  if (lit) {
    delete lit.dataset.spotlit;
    lit = null;
  }
  delete document.body.dataset.spotlight;
  tag?.remove();
  tag = null;
}

function light(el: HTMLElement, name: string | undefined, nav: boolean) {
  if (lit !== el) {
    if (lit) delete lit.dataset.spotlit;
    lit = el;
    el.dataset.spotlit = '';
  }
  if (nav) {
    document.body.dataset.spotlight = 'nav';
    tag?.remove();
    tag = null;
    return;
  }
  document.body.dataset.spotlight = 'card';
  if (!name) return;
  tag ??= document.body.appendChild(document.createElement('div'));
  tag.dataset.slot = 'spotlight-tag';
  tag.textContent = name;
  const r = el.getBoundingClientRect();
  tag.style.left = `${Math.max(8, r.left)}px`;
  tag.style.top = `${Math.max(8, r.top - 28)}px`;
}

/** Where a target is on screen now: a card on the page, a sidebar page, or neither. */
export function onScreen(target: string | null | undefined): 'card' | 'nav' | null {
  if (!target) return null;
  if (target.startsWith('card:')) return cardEl(target.slice(5)) ? 'card' : null;
  return navEl(target) ? 'nav' : null;
}

/**
 * Lights one target (`card:<id>` or an app path) and dims the page around it; null clears. The
 * target scrolls into view only after a short hover.
 */
export function spotlight(target: string | null | undefined, name?: string) {
  if (!target) return clear();
  const card = target.startsWith('card:');
  const el = card ? cardEl(target.slice(5)) : navEl(target);
  if (!el) return clear();
  light(el, name, !card);
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (card && name) light(el, name, false);
  }, 600);
}

/**
 * Point at the page: the cards dim and the one under the cursor (or finger) lights up with its
 * name; a click picks it, Esc or a click off any card cancels.
 */
export function pointAtCard(): Promise<CardOnScreen | null> {
  clear();
  document.body.dataset.pointing = '';
  return new Promise((done) => {
    const under = (e: MouseEvent) =>
      (e.target as Element | null)?.closest?.<HTMLElement>(CARD) ?? null;
    const move = (e: MouseEvent) => {
      const el = under(e);
      if (el) light(el, `${el.dataset.cardTitle ?? ''} · ${kindName(cardOf(el).kind)}`, false);
      else if (lit) {
        delete lit.dataset.spotlit;
        lit = null;
        tag?.remove();
        tag = null;
      }
    };
    const end = (picked: CardOnScreen | null) => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      delete document.body.dataset.pointing;
      clear();
      done(picked);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = under(e);
      end(el ? cardOf(el) : null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      end(null);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  });
}

/** A card's style (`kind:style`) as a person says it: a table, a donut, a page's own card. */
export function kindName(styleId: string): string {
  if (styleId === 'page' || styleId.startsWith('page:')) return 'card';
  const [kind = '', style] = styleId.split(':');
  return (
    WIDGET_STYLES.find((w) => w.kind === kind && w.style === style)?.name.toLowerCase() ?? kind
  );
}
