// Hover shows the target, or point at the page. An option that stands for something on screen names
// it as its `target`: `card:<id>` for a LumenLayout card, or an app path for a sidebar page.
//
//   spotlight(target, name)  the page's other cards dim and a name tag sits above the card; a
//                            sidebar page gets the sidebar's muted fill. No border, no glow.
//   pointAtCard()            the cards dim, the one under the cursor lights up; a click picks it,
//                            Esc cancels. Works on any LumenLayout card with no per-page setup.
//   pointAt()                the same over cards and page sections: any element an app marks
//                            `data-assistant-section="<name>"` (a résumé role, a story, a job),
//                            with `data-assistant-kind` (what it is) and `data-assistant-id`.
//                            A section's target is `section:<id>`; lit, it gets a muted fill.
//
// Both drive the DOM directly through data attributes the theme styles: one spotlight at a time.
import { WIDGET_STYLES } from '@columenlabs/lumen-ui-types/views';

export interface CardOnScreen {
  id: string;
  title: string;
  /** `view` for a table card, else the widget's kind (chart, tiles, ...). */
  kind: string;
}

export interface SectionOnScreen {
  /** `data-assistant-id`, else its name. */
  id: string;
  /** `data-assistant-section`: what the person calls it. */
  label: string;
  /** `data-assistant-kind`: what it is (role, story), `section` by default. */
  kind: string;
}

const CARD = '[data-slot="lumen-card"][data-card]';
const SECTION = '[data-assistant-section]';
const sectionId = (el: HTMLElement) => el.dataset.assistantId || el.dataset.assistantSection || '';
const sectionEl = (id: string) =>
  [...document.querySelectorAll<HTMLElement>(SECTION)].find((el) => sectionId(el) === id) ?? null;

export const sectionOf = (el: HTMLElement): SectionOnScreen => ({
  id: sectionId(el),
  label: el.dataset.assistantSection ?? '',
  kind: el.dataset.assistantKind || 'section',
});

/** The marked sections on the page now, top to bottom (the assistant's own are left out). */
export const sectionsOnScreen = (): SectionOnScreen[] =>
  [...document.querySelectorAll<HTMLElement>(SECTION)]
    .filter((el) => !el.closest('[data-assistant]'))
    .map(sectionOf);

/** An element's text as the model reads it: its words, cut to `max` characters. */
export const textOf = (el: Element | null, max = 3000) =>
  ((el as HTMLElement | null)?.innerText ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

/** The element a `card:<id>` or `section:<id>` target stands for. */
export const targetEl = (target: string) =>
  target.startsWith('card:')
    ? cardEl(target.slice(5))
    : target.startsWith('section:')
      ? sectionEl(target.slice(8))
      : null;
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

function light(el: HTMLElement, name: string | undefined, mode: 'card' | 'nav' | 'section') {
  if (lit !== el) {
    if (lit) delete lit.dataset.spotlit;
    lit = el;
    el.dataset.spotlit = '';
  }
  if (mode === 'nav') {
    document.body.dataset.spotlight = 'nav';
    tag?.remove();
    tag = null;
    return;
  }
  document.body.dataset.spotlight = mode;
  if (!name) return;
  tag ??= document.body.appendChild(document.createElement('div'));
  tag.dataset.slot = 'spotlight-tag';
  tag.textContent = name;
  const r = el.getBoundingClientRect();
  tag.style.left = `${Math.max(8, r.left)}px`;
  tag.style.top = `${Math.max(8, r.top - 28)}px`;
}

/** Where a target is on screen now: a card on the page, a sidebar page, or neither. */
export function onScreen(target: string | null | undefined): 'card' | 'section' | 'nav' | null {
  if (!target) return null;
  if (target.startsWith('card:')) return cardEl(target.slice(5)) ? 'card' : null;
  if (target.startsWith('section:')) return sectionEl(target.slice(8)) ? 'section' : null;
  return navEl(target) ? 'nav' : null;
}

/**
 * Lights one target (`card:<id>`, `section:<id>` or an app path) and dims the page around it; null
 * clears. The target scrolls into view only after a short hover.
 */
export function spotlight(target: string | null | undefined, name?: string) {
  if (!target) return clear();
  const mode = target.startsWith('card:')
    ? 'card'
    : target.startsWith('section:')
      ? 'section'
      : 'nav';
  const el = mode === 'nav' ? navEl(target) : targetEl(target);
  if (!el) return clear();
  light(el, name, mode);
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (mode !== 'nav' && name) light(el, name, mode);
  }, 600);
}

/**
 * Point at the page: the cards dim and the one under the cursor (or finger) lights up with its
 * name; a click picks it, Esc or a click off any card cancels.
 */
export async function pointAtCard(): Promise<CardOnScreen | null> {
  const picked = await pick(CARD);
  return picked?.kind === 'card' ? picked.card : null;
}

/** What `pointAt` picked: a card, or a section an app marked. */
export type PointedAt =
  | { kind: 'card'; card: CardOnScreen; el: HTMLElement }
  | { kind: 'section'; section: SectionOnScreen; el: HTMLElement };

/**
 * Point at a card or a marked section: the one under the cursor lights up with its name, the
 * innermost when they nest; a click picks it, Esc or a click off any cancels.
 */
export const pointAt = () => pick(`${SECTION}, ${CARD}`);

function pick(selector: string): Promise<PointedAt | null> {
  clear();
  document.body.dataset.pointing = '';
  return new Promise((done) => {
    const under = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(selector) ?? null;
      return el?.closest('[data-assistant]') ? null : el;
    };
    const what = (el: HTMLElement): PointedAt =>
      el.matches(CARD)
        ? { kind: 'card', card: cardOf(el), el }
        : { kind: 'section', section: sectionOf(el), el };
    const move = (e: MouseEvent) => {
      const el = under(e);
      if (el) {
        const p = what(el);
        if (p.kind === 'card') light(el, `${p.card.title} · ${kindName(p.card.kind)}`, 'card');
        else light(el, p.section.label, 'section');
      } else if (lit) {
        delete lit.dataset.spotlit;
        lit = null;
        tag?.remove();
        tag = null;
      }
    };
    const end = (picked: PointedAt | null) => {
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
      end(el ? what(el) : null);
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
