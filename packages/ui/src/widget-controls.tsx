// Edit widget ▸ Controls: one switch per control the widget's kind has, each starting from the kind's
// default. A switch back to the default drops the key, so a saved widget keeps only its choices.
import {
  CONTROL_DEFAULTS,
  type ViewCard,
  type ViewCardKind,
  WIDGET_CONTROL_NAMES,
  type WidgetControl,
  controlOn,
  viewCardKinds,
} from '@columenlabs/lumen-ui-types/views';
import { useAssistantName } from './assistant-context';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

type Controls = ViewCard['controls'];

export function WidgetControlsEditor({
  kind,
  style,
  controls,
  onChange,
}: {
  kind: ViewCard['kind'];
  style?: string;
  controls: Controls;
  onChange: (controls: Controls) => void;
}) {
  const type = (viewCardKinds as readonly string[]).includes(kind) ? (kind as ViewCardKind) : null;
  const assistant = useAssistantName('assistant');
  if (!type) return null;
  const keys = Object.keys(CONTROL_DEFAULTS[type]) as WidgetControl[];
  const set = (k: WidgetControl, on: boolean) => {
    const next = { ...controls };
    if (on === CONTROL_DEFAULTS[type][k]) delete next[k];
    else next[k] = on;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {keys.map((k) => {
        const id = `control-${k}`;
        return (
          <div key={k} className="flex items-center gap-2">
            <Switch
              id={id}
              size="sm"
              checked={controlOn({ kind, style, controls }, k)}
              onCheckedChange={(on) => set(k, on)}
            />
            <Label htmlFor={id} className="font-normal">
              {k === 'ask' ? `Ask ${assistant}` : WIDGET_CONTROL_NAMES[k]}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
