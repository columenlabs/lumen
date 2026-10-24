// A secret the app shows only once (a new API key, a signing secret): a warning to copy it now,
// the value in code type with a Show switch, and a Copy button that says when it worked.
import { Check, Copy, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Alert, AlertDescription } from './ui/alert';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';

export function LumenSecret({
  value,
  label = 'Secret',
  warning = 'Copy it now. It won’t be shown again.',
  hidden = false,
}: {
  value: string;
  label?: string;
  warning?: ReactNode;
  /** Start with the value masked. */
  hidden?: boolean;
}) {
  const [show, setShow] = useState(!hidden);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {warning && (
        <Alert>
          <TriangleAlert />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
      <InputGroup className="h-10">
        <InputGroupInput
          readOnly
          aria-label={label}
          type={show ? 'text' : 'password'}
          value={value}
          className="font-code text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff /> : <Eye />}
          </InputGroupButton>
          <InputGroupButton size="xs" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
