// The Tab drawer: one panel for a tab the person may edit, on every app. It
// names the tab and picks its icon (the shared IconPicker); Remove sits in the footer when the tab
// can go. The app keeps the tab and saves what comes back.
import type { ViewIcon } from '@columenlabs/lumen-types/views';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LumenConfirm } from './confirm';
import { SaveButton } from './form-issues';
import { IconButton } from './icon-button';
import { IconPicker } from './icon-picker';
import { LumenDrawer } from './lumen-drawer';
import type { NavIcon } from './nav';
import { Button } from './ui/button';
import { Input } from './ui/input';

/** A tab's name, at most this long unless the app keeps longer ones. */
export const TAB_NAME_MAX = 30;

export function LumenTabDrawer({
  open,
  onClose,
  name,
  icon,
  fallback,
  description = 'Its filters and columns save as you change them.',
  onSave,
  busy,
  error,
  remove,
  maxName = TAB_NAME_MAX,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  icon: ViewIcon | null | undefined;
  /** The icon shown with none picked. */
  fallback: NavIcon;
  description?: string;
  onSave: (next: { name: string; icon: ViewIcon | null }) => void;
  busy?: boolean;
  /** A failed save, under the fields. */
  error?: string | null;
  /** The footer's Remove: what goes and what stays. Left out, the tab cannot be removed here. */
  remove?: { description: string; onRemove: () => void };
  /** The longest name this app keeps. */
  maxName?: number;
}) {
  const [typed, setTyped] = useState(name);
  const [picked, setPicked] = useState<ViewIcon | null>(icon ?? null);
  // A drawer opened again starts from the tab as it is now.
  useEffect(() => {
    if (open) {
      setTyped(name);
      setPicked(icon ?? null);
    }
  }, [open, name, icon]);
  const next = typed.trim();
  const changed = next !== name || picked !== (icon ?? null);
  return (
    <LumenDrawer
      open={open}
      onClose={onClose}
      title="Tab"
      description={description}
      footer={
        <>
          {remove && (
            <LumenConfirm
              title={`Remove tab ${name}?`}
              description={remove.description}
              action="Remove"
              onConfirm={remove.onRemove}
            >
              <IconButton icon={Trash2Icon} label="Remove tab" variant="destructive" />
            </LumenConfirm>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <SaveButton
            issues={
              next ? [] : [{ where: 'Name', message: 'Give it a name', target: 'lumen-tab-name' }]
            }
            disabled={!changed}
            busy={busy}
            onSave={() => onSave({ name: next, icon: picked })}
          />
        </>
      }
    >
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 pt-2 text-sm">
        <span className="text-muted-foreground">Name</span>
        <Input
          id="lumen-tab-name"
          className="h-8"
          value={typed}
          maxLength={maxName}
          onChange={(e) => setTyped(e.target.value)}
        />
        <span className="text-muted-foreground">Icon</span>
        <div>
          <IconPicker
            value={picked}
            onChange={setPicked}
            fallback={fallback}
            label="Tab icon"
            variant="outline"
          />
        </div>
      </div>
      {error && <p className="pt-2 text-sm text-destructive">{error}</p>}
    </LumenDrawer>
  );
}
