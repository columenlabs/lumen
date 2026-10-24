// A labelled on/off switch for a card's header (`tools`) or toolbar: one
// control for a mode a card turns on, like Tune's Advanced, instead of a pair of buttons in its body.
import { useId } from 'react';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

export function CardSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} size="sm" />
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
    </div>
  );
}

/** A one-of-a-few choice for a card's header (`tools`), such as the live basket Orders card's
 * Live | Shadow: a segmented control that never goes empty. */
export function CardSegments<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onValueChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-2.5 text-xs">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
