import { PanelRightCloseIcon, PanelRightOpenIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton, type IconButtonProps } from './icon-button';
import { lazyPart } from './lazy-part';
import { ResizeEdge, tabState, useDockSlot } from './side-dock';
import { pickerOpen } from './ui/overlay-guard';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';

/** The resizable panels load with the first drawer opened; until then it opens at its default width. */
const loadPanels = () => import('./lumen-drawer-panels');
const DrawerPanels = lazyPart(() => loadPanels().then((m) => m.DrawerPanels));

/**
 * One of a drawer's actions, as data: the drawer draws it as an icon button with its name in the
 * tooltip, so a drawer's actions are never text. Destructive ones go first, as the footer lists them.
 */
export type DrawerAction = Pick<
  IconButtonProps,
  'icon' | 'label' | 'onClick' | 'busy' | 'disabled' | 'pressed' | 'to' | 'href'
> & {
  /** Delete, remove: drawn in the destructive colour. */
  destructive?: boolean;
};

/** A drawer's width on desktop, as the resizable panel takes it ("32%", "320px"). */
type Size = `${number}%` | `${number}px`;

export interface LumenDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A muted line under the title ("Active · invited Oct 16"); read aloud only when left out. */
  description?: ReactNode;
  /** Stacked DrawerSections; the drawer pads and scrolls them. */
  children: ReactNode;
  /** The footer's actions as data, right-aligned in order, before `footer`: always icons. */
  actions?: readonly DrawerAction[];
  /** Last in the footer, after `actions`: the `SaveButton`. No footer when this, `actions` and `footerStart` are left out. */
  footer?: ReactNode;
  /** Left side of the footer: a count or status line ("12 releases"). */
  footerStart?: ReactNode;
  /** Width on desktop: starts at `defaultSize`, drags between `minSize` and `maxSize`. */
  defaultSize?: Size;
  minSize?: Size;
  maxSize?: Size;
  /**
   * Docks it beside the page on desktop instead of over it, under this name: a click on the page
   * leaves it open (a list's next row swaps what it shows), it folds to a rail, and its width and
   * fold are kept in this browser. A phone still gets the bottom sheet.
   */
  dock?: string;
}

/**
 * The suite's one pullout drawer (named LumenDrawer), on every app.
 * Phone: a bottom sheet. Desktop: a right-side panel over the page whose width drags at its left
 * edge, 320px to 60% by default. The sheet spans the screen so the resizable group has room; only
 * the handle and the drawer take the pointer, so a click beside it falls through to the overlay
 * and closes it (`!` beats the inline pointer-events Radix sets on a modal's content). Its body
 * holds DrawerSections; its footer sits at the bottom (actions on the right, Close by default; on a
 * phone it shows only when there are actions, as the sheet's X closes it). With `dock` it sits beside
 * the page on desktop instead (DockedDrawer), for a list whose rows each open it.
 */
export function LumenDrawer({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  footer,
  footerStart,
  defaultSize = '32%',
  minSize = '320px',
  maxSize = '60%',
  dock,
}: LumenDrawerProps) {
  const isMobile = useIsMobile();
  const slot = useDockSlot();
  // Fetched once the page is idle, so the first drawer opened on a desktop has its panels ready.
  useEffect(() => {
    if (isMobile) return;
    const t = setTimeout(loadPanels, 2000);
    return () => clearTimeout(t);
  }, [isMobile]);
  const head = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <SheetTitle className="truncate" title={typeof title === 'string' ? title : undefined}>
        {title}
      </SheetTitle>
      <SheetDescription
        className={description ? 'truncate text-muted-foreground text-xs' : 'sr-only'}
        title={typeof description === 'string' ? description : undefined}
      >
        {description ?? 'Details'}
      </SheetDescription>
    </div>
  );
  const body = <div className="flex flex-col px-4 pb-4">{children}</div>;
  // A drawer with actions ends on a footer, styled like a dialog's: the body scrolls above it and
  // ends on a clear edge. Without actions it has none: the header's × already closes it.
  const acts = actions?.length ? actions : null;
  const foot = (acts || footer || footerStart) && (
    <footer
      data-slot="drawer-footer"
      className="flex shrink-0 items-center gap-2 border-t bg-muted/50 px-4 py-2.5"
    >
      {footerStart && (
        <div className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{footerStart}</div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {acts?.map(({ destructive, ...a }) => (
          <IconButton
            key={a.label}
            {...a}
            className={destructive ? 'text-destructive hover:text-destructive' : undefined}
          />
        ))}
        {footer}
      </div>
    </footer>
  );
  if (dock && !isMobile && slot)
    return open
      ? createPortal(
          <DockedDrawer
            dock={dock}
            title={title}
            description={description}
            onClose={onClose}
            defaultSize={defaultSize}
            minSize={minSize}
            maxSize={maxSize}
            body={body}
            foot={foot}
          />,
          slot,
        )
      : null;
  return (
    // Not modal on desktop: the assistant, docked beside it, stays usable while the drawer is open.
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={isMobile}>
      {isMobile ? (
        <SheetContent side="bottom" className="max-h-[85svh] gap-0 overflow-hidden">
          <SheetHeader className="order-first shrink-0 border-b pt-3">{head}</SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">{body}</div>
          {foot}
        </SheetContent>
      ) : (
        <SheetContent
          side="right"
          showCloseButton={false}
          // The resize handle's grab zone is wider than the handle, so a drag can start on the
          // overlay; the panels library marks that pointerdown handled, and then it doesn't close.
          onPointerDownOutside={(e) =>
            e.detail.originalEvent.defaultPrevented && e.preventDefault()
          }
          className="pointer-events-none! gap-0 border-0 bg-transparent shadow-none data-[side=right]:left-0 data-[side=right]:w-auto data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none"
        >
          <DrawerPanels defaultSize={defaultSize} minSize={minSize} maxSize={maxSize}>
            <section className="flex h-full flex-col overflow-hidden">
              <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
                {head}
                <SheetClose asChild>
                  <IconButton icon={XIcon} label="Close" className="ml-auto" />
                </SheetClose>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto pt-2">{body}</div>
              {foot}
            </section>
          </DrawerPanels>
        </SheetContent>
      )}
    </Sheet>
  );
}

/** What each docked drawer keeps, by its `dock` name: its dragged width (0: the default) and its fold. */
const docks = new Map<
  string,
  { width: ReturnType<typeof tabState<number>>; folded: ReturnType<typeof tabState<boolean>> }
>();
function dockState(dock: string) {
  let d = docks.get(dock);
  if (!d) {
    d = {
      width: tabState(
        `lumen_dock_${dock}_width`,
        0,
        (raw) => {
          const n = Math.round(Number(raw));
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        'local',
      ),
      folded: tabState(`lumen_dock_${dock}_folded`, false, (raw) => raw === 'true', 'local'),
    };
    docks.set(dock, d);
  }
  return d;
}

const onResize = (l: () => void) => {
  window.addEventListener('resize', l);
  return () => window.removeEventListener('resize', l);
};
/** A Size in px, a percentage being of the window's width. */
const px = (size: Size, vw: number) =>
  size.endsWith('%') ? (vw * Number.parseFloat(size)) / 100 : Number.parseFloat(size);
/** Room a docked drawer always leaves the page, px. */
const PAGE_MIN = 480;

/**
 * A drawer docked right of the page (LumenShell's dock slot): the page narrows beside it and stays
 * usable. Its left edge drags the width within `minSize` and `maxSize` (never leaving the page under
 * PAGE_MIN); it folds to a rail that shows its title; Esc in it closes it, unless a picker in it is open.
 */
function DockedDrawer({
  dock,
  title,
  description,
  onClose,
  defaultSize,
  minSize,
  maxSize,
  body,
  foot,
}: {
  dock: string;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  defaultSize: Size;
  minSize: Size;
  maxSize: Size;
  body: ReactNode;
  foot: ReactNode;
}) {
  const state = dockState(dock);
  const saved = state.width.use();
  const folded = state.folded.use();
  const [drag, setDrag] = useState<number | null>(null);
  const vw = useSyncExternalStore(
    onResize,
    () => window.innerWidth,
    () => 1440,
  );
  const min = Math.round(px(minSize, vw));
  const max = Math.max(min, Math.round(Math.min(px(maxSize, vw), vw - PAGE_MIN)));
  const clamp = (w: number) => Math.max(min, Math.min(w, max));
  const width = drag ?? clamp(saved || px(defaultSize, vw));
  const name = typeof title === 'string' ? title : 'Details';
  return (
    <aside
      aria-label={name}
      data-slot="lumen-drawer"
      data-docked=""
      data-folded={folded ? '' : undefined}
      style={folded ? undefined : { width }}
      className="sticky top-0 flex h-svh shrink-0 flex-col border-l bg-background data-folded:w-11"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || pickerOpen()) return;
        // Only Esc from inside it: one from a dialog it opened (a portal) is that dialog's.
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        onClose();
      }}
    >
      {folded ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-hidden py-3">
          <IconButton
            icon={PanelRightOpenIcon}
            label="Expand panel"
            onClick={() => state.folded.write(false)}
          />
          <span
            className="min-h-0 truncate text-muted-foreground text-xs [writing-mode:vertical-rl]"
            title={name}
          >
            {title}
          </span>
        </div>
      ) : (
        <>
          <ResizeEdge
            name={name}
            width={width}
            min={min}
            max={max}
            slot="lumen-drawer-resize"
            onDrag={setDrag}
            onWidth={(w) => {
              setDrag(null);
              state.width.write(w);
            }}
          />
          <header className="flex shrink-0 items-center gap-1 border-b px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2
                className="cn-font-heading truncate font-medium text-base text-foreground"
                title={name}
              >
                {title}
              </h2>
              {description && (
                <p
                  className="truncate text-muted-foreground text-xs"
                  title={typeof description === 'string' ? description : undefined}
                >
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon={PanelRightCloseIcon}
              label="Collapse panel"
              onClick={() => state.folded.write(true)}
            />
            <IconButton icon={XIcon} label="Close" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">{body}</div>
          {foot}
        </>
      )}
    </aside>
  );
}
