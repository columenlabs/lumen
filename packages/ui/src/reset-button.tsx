// Puts a setting back to its default: a ↺ that shows only when something
// differs from the default, its tooltip naming what it goes back to.
import { RotateCcwIcon } from 'lucide-react';
import { IconButton } from './icon-button';

export interface ResetButtonProps {
  /** Whether anything differs from the default; nothing shows when it doesn't. */
  changed: boolean;
  /** The tooltip and accessible name: "Reset to 15 – 45", "Reset all". */
  label: string;
  onReset: () => void;
  size?: 'icon-xs' | 'icon-sm';
}

export function ResetButton({ changed, label, onReset, size = 'icon-xs' }: ResetButtonProps) {
  if (!changed) return null;
  return <IconButton icon={RotateCcwIcon} label={label} size={size} onClick={onReset} />;
}
