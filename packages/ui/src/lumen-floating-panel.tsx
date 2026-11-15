import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon } from 'lucide-react';
import * as React from 'react';
import { Rnd } from 'react-rnd';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** Where the panel sits in its box, and how big it is, px. */
export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LumenFloatingPanelProps {
  /** Its name for screen readers, and the fold button's tooltip. */
  title: string;
  /** Its top row (tabs, a title), between the grip and the fold button. Shown folded too. */
  header?: React.ReactNode;
  /** What it holds. It stays mounted while folded, so running work inside keeps going. */
  children: React.ReactNode;
  /** Where it starts on a device that has not moved it yet. */
  defaultRect?: Partial<FloatingRect>;
  /** Kept on this device under this key: where the person left it, its size and whether it is folded. */
  storageKey?: string;
  /** Folded to its header, controlled (left out, it keeps its own and the device remembers it). */
  folded?: boolean;
  onFold?: (folded: boolean) => void;
  minWidth?: number;
  minHeight?: number;
  className?: string;
}

const DEFAULT: FloatingRect = { x: 12, y: 12, width: 330, height: 300 };

function load(key: string | undefined): { rect?: FloatingRect; folded?: boolean } {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * A see-through panel that floats over a live page (a 3D view, a map) inside its parent: the person
 * drags it by its grip, resizes it from its edges and corner, and folds it to its header. Its box is
 * the parent (which must be `relative`), and it is kept inside it when the box changes size (a phone
 * turning). Taps outside it reach the page. Built on react-rnd.
 */
export function LumenFloatingPanel({
  title,
  header,
  children,
  defaultRect,
  storageKey,
  folded: foldedProp,
  onFold,
  minWidth = 240,
  minHeight = 160,
  className,
}: LumenFloatingPanelProps) {
  const saved = React.useMemo(() => load(storageKey), [storageKey]);
  const [rect, setRect] = React.useState<FloatingRect>(
    saved.rect ?? { ...DEFAULT, ...defaultRect },
  );
  const [foldedOwn, setFoldedOwn] = React.useState(!!saved.folded);
  const folded = foldedProp ?? foldedOwn;
  const setFolded = (f: boolean) => {
    setFoldedOwn(f);
    onFold?.(f);
  };
  const box = React.useRef<HTMLDivElement>(null);
  const [room, setRoom] = React.useState<{ w: number; h: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    read();
    const seen = new ResizeObserver(read);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ rect, folded }));
    } catch {}
  }, [storageKey, rect, folded]);
  // Inside the box whatever its size now: smaller than the box, and moved back in if it hangs out.
  const fit = (r: FloatingRect): FloatingRect => {
    if (!room) return r;
    const width = Math.max(Math.min(minWidth, room.w), Math.min(r.width, room.w));
    const height = Math.max(Math.min(minHeight, room.h), Math.min(r.height, room.h));
    return {
      width,
      height,
      x: Math.max(0, Math.min(r.x, room.w - width)),
      y: Math.max(0, Math.min(r.y, room.h - height)),
    };
  };
  const shown = fit(rect);
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-20">
      {room && (
        <Rnd
          bounds="parent"
          position={{ x: shown.x, y: shown.y }}
          size={{ width: shown.width, height: folded ? 'auto' : shown.height }}
          minWidth={minWidth}
          minHeight={folded ? undefined : minHeight}
          dragHandleClassName="lumen-float-grip"
          enableResizing={
            folded
              ? false
              : { right: true, bottom: true, bottomRight: true, left: true, bottomLeft: true }
          }
          // A finger needs a fuller edge than a mouse: 12px edges, a 24px corner.
          resizeHandleStyles={{
            right: { width: 12, right: -6 },
            left: { width: 12, left: -6 },
            bottom: { height: 12, bottom: -6 },
            bottomRight: { width: 24, height: 24, right: -6, bottom: -6 },
            bottomLeft: { width: 24, height: 24, left: -6, bottom: -6 },
          }}
          onDragStop={(_e, d) => setRect((r) => ({ ...r, x: d.x, y: d.y }))}
          onResizeStop={(_e, _dir, el, _delta, pos) =>
            setRect({ x: pos.x, y: pos.y, width: el.offsetWidth, height: el.offsetHeight })
          }
          className="pointer-events-auto"
        >
          <section
            data-slot="lumen-floating-panel"
            aria-label={title}
            className={cn(
              'flex h-full flex-col overflow-hidden rounded-xl border bg-popover/85 text-popover-foreground shadow-lg backdrop-blur-md',
              className,
            )}
          >
            <div className="flex shrink-0 items-center gap-0.5 border-b pr-1">
              <span
                className="lumen-float-grip flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
                aria-hidden
              >
                <GripVerticalIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">{header}</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={folded ? `Open ${title}` : `Fold ${title}`}
                    aria-expanded={!folded}
                    onClick={() => setFolded(!folded)}
                  >
                    {folded ? <ChevronDownIcon /> : <ChevronUpIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{folded ? `Open ${title}` : `Fold ${title}`}</TooltipContent>
              </Tooltip>
            </div>
            <div className={cn('flex min-h-0 flex-1 flex-col', folded && 'hidden')}>{children}</div>
          </section>
        </Rnd>
      )}
    </div>
  );
}
