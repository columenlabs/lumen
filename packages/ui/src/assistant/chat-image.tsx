// ChatImage: an image in a chat message. A thumbnail until clicked; then it opens full width in place,
// where a pinch (or Ctrl + wheel) zooms at the pointer, a drag or two fingers pan and a double-click
// toggles fit and 2× (react-zoom-pan-pinch). Its toolbar zooms, resets, opens the image in a 90%
// lightbox with the same controls (the kit's Dialog: Esc, × or a click outside closes it) and
// shrinks it back to the thumbnail.
import {
  Maximize2Icon,
  Minimize2Icon,
  RotateCcwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  TransformComponent,
  TransformWrapper,
  useControls,
  useTransformEffect,
} from 'react-zoom-pan-pinch';
import { IconButton } from '../icon-button';
import { cn } from '../lib/utils';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

const MAX_SCALE = 8;

/** The zoom buttons and the scale between them; `children` are the buttons after a divider. */
function ZoomBar({ children }: { children: React.ReactNode }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const [scale, setScale] = useState(1);
  useTransformEffect(({ state }) => setScale(state.scale));
  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border bg-popover/90 p-0.5 text-popover-foreground shadow-sm backdrop-blur-sm"
      data-slot="image-zoom-bar"
    >
      <IconButton
        icon={ZoomOutIcon}
        label="Zoom out"
        disabled={scale <= 1.001}
        onClick={() => zoomOut()}
      />
      <span className="num min-w-10 text-center text-muted-foreground text-xs" aria-live="polite">
        {Math.round(scale * 100)}%
      </span>
      <IconButton
        icon={ZoomInIcon}
        label="Zoom in"
        disabled={scale >= MAX_SCALE - 0.001}
        onClick={() => zoomIn()}
      />
      <IconButton icon={RotateCcwIcon} label="Reset zoom" onClick={() => resetTransform()} />
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {children}
    </div>
  );
}

/** The image at fit (scale 1), with zoom and pan; the wrapper takes the box its parent gives it. */
function Zoomable({
  src,
  alt,
  panAtFit = false,
  children,
}: {
  src: string;
  alt: string;
  /** Two fingers pan even at fit (the lightbox); in the chat they scroll the chat until zoomed in. */
  panAtFit?: boolean;
  children: React.ReactNode;
}) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <TransformWrapper
      minScale={1}
      maxScale={MAX_SCALE}
      centerZoomedOut
      // A pinch (a wheel with ctrlKey) zooms; two fingers or a plain wheel pan.
      wheel={{ step: 0.01, wheelDisabled: true }}
      trackPadPanning={{ disabled: !panAtFit && !zoomed, velocityDisabled: true }}
      onTransform={(_, { scale }) => setZoomed(scale > 1.001)}
      doubleClick={{ mode: 'toggle', step: 1 }}
    >
      <ZoomBar>{children}</ZoomBar>
      <TransformComponent
        wrapperClass="!size-full cursor-grab active:cursor-grabbing"
        contentClass="!size-full"
      >
        <img src={src} alt={alt} draggable={false} className="size-full object-contain" />
      </TransformComponent>
    </TransformWrapper>
  );
}

export function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);

  if (!open) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="View larger"
            onClick={() => setOpen(true)}
            className="group/thumb relative cursor-zoom-in overflow-hidden rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={src}
              alt={alt}
              className="max-h-32 max-w-40 object-cover"
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w && h) setRatio(w / h);
              }}
            />
            <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-background/80 opacity-0 transition-opacity group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100">
              <Maximize2Icon className="size-3.5" aria-hidden />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>View larger</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <div
        className="relative w-full overflow-hidden rounded-md border bg-background"
        style={{ aspectRatio: ratio ?? 4 / 3, maxHeight: '60vh' }}
        data-slot="chat-image"
      >
        <Zoomable src={src} alt={alt}>
          <IconButton icon={Maximize2Icon} label="Full screen" onClick={() => setFull(true)} />
          <IconButton
            icon={Minimize2Icon}
            label="Shrink"
            onClick={() => {
              setOpen(false);
              setFull(false);
            }}
          />
        </Zoomable>
      </div>
      <ImageLightbox src={src} alt={alt} open={full} onOpenChange={setFull} />
    </>
  );
}

/** An image over 90% of the screen with zoom and pan (the kit's Dialog: Esc, × or a click outside closes it). */
export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // Focus the box, not its first button: a focused button shows its tooltip, which would take
        // the first Esc.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        className={cn(
          'h-[90vh] w-[90vw] max-w-none overflow-hidden p-0 sm:max-w-none',
          'max-md:h-full max-md:w-full',
        )}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div className="relative size-full">
          <Zoomable src={src} alt={alt} panAtFit>
            <DialogClose asChild>
              <IconButton icon={XIcon} label="Close" />
            </DialogClose>
          </Zoomable>
        </div>
      </DialogContent>
    </Dialog>
  );
}
