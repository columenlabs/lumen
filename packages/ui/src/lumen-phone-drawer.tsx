// A phone's panel beside a live page (a 3D view, a map, a canvas): from the bottom upright, docked
// right sideways, with a window's controls (minimize, maximize or restore, close) in its header.
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** How big the drawer is: its header only (`min`), its rest (`normal`) or the whole area (`max`). */
export type PhoneDrawerSize = 'min' | 'normal' | 'max';

export interface LumenPhoneDrawerProps {
  /** Its name: the header's title, the region's name and each control's tooltip ("Close Parts"). */
  title: string;
  /** The panel's icon, first in the header (the toolbar button's icon). */
  icon?: React.ComponentType<{ className?: string }>;
  /** Shown. Closed, it stays mounted but hidden, so work running inside it (an answer, an upload) keeps going. */
  open: boolean;
  /** The phone is held sideways: docked at the right instead of rising from the bottom. */
  sideways?: boolean;
  /** The × in its header. */
  onClose: () => void;
  /** Its size, controlled. Left out, the drawer keeps its own (it starts `normal`). */
  size?: PhoneDrawerSize;
  onSizeChange?: (size: PhoneDrawerSize) => void;
  /** The panel's own buttons, just before the window controls (an icon button or two). */
  actions?: React.ReactNode;
  /** What it holds. Fills the part on screen, so a footer or composer at its bottom stays in view. */
  children: React.ReactNode;
  className?: string;
}

const SlotContext = React.createContext<HTMLElement | null>(null);

/**
 * The header slot of the drawer around this panel, or null outside one. A panel that is also drawn on
 * a desktop reads it to move its own top row (a filter, undo and redo, a count) into the drawer's
 * header instead of a row of its own.
 */
export function usePhoneDrawerHeader(): HTMLElement | null {
  return React.useContext(SlotContext);
}

/**
 * Puts its children in the header of the drawer around it, after the panel's icon; the title then
 * hides (it stays the region's name). Outside a drawer it draws nothing.
 */
export function PhoneDrawerHeader({ children }: { children: React.ReactNode }) {
  const slot = usePhoneDrawerHeader();
  return slot
    ? createPortal(<div className="flex min-w-0 items-center gap-1">{children}</div>, slot)
    : null;
}

export interface PhoneDrawerFilterProps<T extends string> {
  /** The choices, first one the default. `after` follows the label (a count). */
  options: { value: T; label: string; after?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  /** Its name for screen readers. */
  label?: string;
  className?: string;
}

/** A drawer header's filter chips (All | Favorites | Changed): one joined group, one choice. */
export function PhoneDrawerFilter<T extends string>({
  options,
  value,
  onChange,
  label = 'Filter',
  className,
}: PhoneDrawerFilterProps<T>) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn('flex-none', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-7 px-2.5 text-xs">
          {o.label}
          {o.after !== undefined && o.after !== null && o.after !== false && (
            <span className="num">{o.after}</span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * A phone's panel beside a live page. Upright it rises from the bottom (55% of the area); sideways it
 * docks at the right (340 px, at most 45%). Its header holds the panel's icon, its title, a slot the
 * panel fills with its own controls, and a window's controls: minimize (header only, or a thin rail
 * sideways), maximize (the whole area; the page beside it gets no room but stays mounted) or restore,
 * and close. No dim, no blur: the page stays live. The page beside it is `min-h-0 min-w-0 flex-1` in
 * the same flex box, so a maximized drawer takes all of it. See docs/parts/phone-drawer.md.
 */
export function LumenPhoneDrawer({
  title,
  icon: Icon,
  open,
  sideways = false,
  onClose,
  size: sizeProp,
  onSizeChange,
  actions,
  children,
  className,
}: LumenPhoneDrawerProps) {
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const [own, setOwn] = React.useState<PhoneDrawerSize>('normal');
  const size = sizeProp ?? own;
  const setSize = (s: PhoneDrawerSize) => {
    if (sizeProp === undefined) setOwn(s);
    onSizeChange?.(s);
  };
  const min = size === 'min';
  const max = size === 'max';
  const rail = sideways && min;
  // Maximized it takes what the box's other rows leave (an app's header, toolbar, status bar), never
  // the box's full height: `h-full` beside them pushed its bottom (a chat's text box) off the screen.
  const box = sideways
    ? min
      ? 'w-12 border-l'
      : max
        ? 'min-w-0 flex-[1_1_100%]'
        : 'w-(--phone-drawer-width) max-w-[45%] border-l'
    : max
      ? 'min-h-0 flex-[1_1_100%]'
      : cn(min ? 'h-12' : 'h-[55%]', 'rounded-t-2xl border-t shadow-[0_-8px_24px_rgb(0_0_0/0.25)]');
  const control = (
    label: string,
    icon: React.ComponentType<{ className?: string }>,
    to: PhoneDrawerSize,
    part: string,
  ) => (
    <IconButton
      icon={icon}
      label={`${label} ${title}`}
      className="flex-none"
      data-drawer-control={part}
      onClick={() => setSize(to)}
    />
  );
  return (
    <section
      aria-label={title}
      data-lumen-phone-drawer=""
      data-size={size}
      data-sideways={sideways || undefined}
      hidden={!open}
      className={cn(
        open ? 'flex' : 'hidden',
        'min-h-0 min-w-0 flex-none flex-col bg-background',
        box,
        className,
      )}
    >
      <div
        className={
          rail
            ? 'flex flex-none flex-col items-center gap-1 py-1'
            : cn(
                'flex h-12 flex-none items-center gap-1 pr-2 pl-3.5',
                !min && 'border-b [&:has([data-drawer-slot]:not(:empty))_h2]:sr-only',
              )
        }
      >
        {!rail && Icon && <Icon className="size-4 flex-none text-primary" />}
        <h2
          className={
            rail
              ? 'sr-only'
              : 'min-w-0 truncate pl-1 text-(length:--phone-drawer-title) font-semibold'
          }
          title={title}
        >
          {title}
        </h2>
        <div
          ref={setSlot}
          data-drawer-slot=""
          className={cn(min ? 'hidden' : 'flex', 'min-w-0 flex-1 items-center gap-1')}
        />
        {min && !rail && <span className="flex-1" />}
        {!min && actions}
        {/* A window's controls, edge to edge: minimize or restore, maximize or restore, close. */}
        <div
          className={rail ? 'flex flex-none flex-col items-center' : 'flex flex-none items-center'}
          data-drawer-controls=""
        >
          {min
            ? control('Restore', CopyIcon, 'normal', 'restore')
            : control('Minimize', MinusIcon, 'min', 'minimize')}
          {max
            ? control('Restore', CopyIcon, 'normal', 'restore')
            : control('Maximize', SquareIcon, 'max', 'maximize')}
          <IconButton
            icon={XIcon}
            label={`Close ${title}`}
            className="flex-none"
            data-drawer-control="close"
            onClick={onClose}
          />
        </div>
      </div>
      <SlotContext.Provider value={slot}>
        <div className={cn(min ? 'hidden' : 'flex', 'min-h-0 flex-1 flex-col')}>{children}</div>
      </SlotContext.Provider>
    </section>
  );
}
