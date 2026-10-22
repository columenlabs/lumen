// The icon picker (for views; shared for tabs): a popup with every
// lucide icon, the quick picks first, and every emoji. A view's sidebar icon and an editable tab's
// icon both pick here; the value is a lucide name or one emoji (`viewIconSchema`).
import type { ViewIcon } from '@columenlabs/lumen-ui-types/views';
import { RotateCcwIcon, SearchIcon, ShapesIcon, SmileIcon } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from './icon-button';
import type { NavIcon } from './nav';
import { Button } from './ui/button';
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from './ui/emoji-picker';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Separator } from './ui/separator';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { VIEW_ICONS, iconOf, lucideIconNames } from './view-icons';

/** Icon matches shown at once; search narrows the rest of lucide's set. */
const ICON_MATCHES = 120;

export function IconPicker({
  value,
  onChange,
  fallback,
  label,
  resetLabel = 'Use the default icon',
  variant,
  id,
}: {
  value: ViewIcon | null | undefined;
  /** null puts the default back. */
  onChange: (icon: ViewIcon | null) => void;
  /** What shows with no pick. */
  fallback: NavIcon;
  /** The trigger's tooltip. */
  label: string;
  resetLabel?: string;
  variant?: 'ghost' | 'outline';
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'icons' | 'emoji'>('icons');
  const [q, setQ] = useState('');
  const Icon = iconOf(value, fallback);
  const pick = (icon: ViewIcon | null) => {
    onChange(icon);
    setOpen(false);
  };
  const term = q.trim().toLowerCase().replace(/\s+/g, '-');
  const quick = Object.keys(VIEW_ICONS);
  const names = (
    term
      ? lucideIconNames.filter((n) => n.includes(term))
      : [...quick, ...lucideIconNames.filter((n) => !quick.includes(n))]
  ).slice(0, ICON_MATCHES);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <IconButton id={id} icon={Icon} label={label} variant={variant} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-0 p-0"
      >
        <div className="p-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            className="w-full"
            aria-label="Icons or emoji"
            value={kind}
            onValueChange={(v) => v && setKind(v as typeof kind)}
          >
            <ToggleGroupItem value="icons" className="flex-1">
              <ShapesIcon />
              Icons
            </ToggleGroupItem>
            <ToggleGroupItem value="emoji" className="flex-1">
              <SmileIcon />
              Emoji
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Separator />
        {kind === 'icons' ? (
          <div className="flex h-80 flex-col">
            <div className="border-b p-2">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search icons"
                  placeholder={`Search ${lucideIconNames.length.toLocaleString()} icons`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </InputGroup>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {names.length ? (
                <div className="grid grid-cols-8 gap-1">
                  {names.map((n) => {
                    const I = iconOf(n, fallback);
                    return (
                      <Button
                        key={n}
                        variant={value === n ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        title={n}
                        aria-label={`Icon ${n}`}
                        aria-pressed={value === n}
                        onClick={() => pick(n)}
                      >
                        <I />
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No icon found.</p>
              )}
            </div>
          </div>
        ) : (
          <EmojiPicker
            className="h-80 w-full"
            columns={9}
            onEmojiSelect={({ emoji }) => pick(emoji)}
          >
            <EmojiPickerSearch placeholder="Search emoji" />
            <EmojiPickerContent />
          </EmojiPicker>
        )}
        <Separator />
        <IconButton
          icon={RotateCcwIcon}
          label={resetLabel}
          className="m-1"
          disabled={!value}
          onClick={() => pick(null)}
        />
      </PopoverContent>
    </Popover>
  );
}
