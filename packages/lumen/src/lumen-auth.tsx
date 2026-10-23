// The signed-out screens every app shares: a split page (the app's story on the left, hidden on
// a phone, the form on the right) and the fields its forms are built from. The app passes its
// brand, pitch, points, illustration and footer links; the kit draws the layout.
import { Lock, Mail } from 'lucide-react';
import { type ComponentType, type ReactNode, useId, useState } from 'react';
import { Alert, AlertDescription } from './ui/alert';
import { Checkbox } from './ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';

export interface LumenAuthPoint {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

export interface LumenAuthStageProps {
  /** The app's logo and name, shown over the story and, on a phone, over the form. */
  brand: ReactNode;
  /** The story's headline and the line under it. */
  pitch: { title: ReactNode; body?: ReactNode };
  points?: LumenAuthPoint[];
  /** A picture under the points, such as a diagram of what the app does. Without one, the
   *  story is centred in the pane. */
  illustration?: ReactNode;
  /** Small links under the form (privacy, terms). */
  footer?: ReactNode;
  children: ReactNode;
}

/** The page a signed-out screen sits in. */
export function LumenAuthStage({
  brand,
  pitch,
  points = [],
  illustration,
  footer,
  children,
}: LumenAuthStageProps) {
  const story = (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="text-balance font-semibold text-3xl leading-tight">{pitch.title}</h2>
        {pitch.body && <p className="max-w-md text-muted-foreground">{pitch.body}</p>}
      </div>
      {points.length > 0 && (
        <ul className="flex flex-col gap-4">
          {points.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4.5" />
              </span>
              <span className="flex flex-col">
                <span className="font-medium text-sm">{title}</span>
                <span className="text-muted-foreground text-sm">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-10 border-r bg-sidebar px-10 py-8 text-sidebar-foreground lg:flex">
        {brand}
        {illustration ? (
          <>
            {story}
            {illustration}
          </>
        ) : (
          // With no picture under it, the story sits in the middle of the pane.
          <div className="flex flex-1 flex-col justify-center gap-10 pb-16">{story}</div>
        )}
      </aside>
      <main className="flex flex-col bg-background px-6 py-8 sm:px-12">
        <div className="lg:hidden">{brand}</div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8">
          {children}
        </div>
        {footer && <div className="text-center text-muted-foreground text-xs">{footer}</div>}
      </main>
    </div>
  );
}

/** A screen's title, and a line under it. */
export function LumenAuthHeading({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <h1 className="font-semibold text-2xl">{title}</h1>
      {sub && <p className="text-muted-foreground text-sm">{sub}</p>}
    </div>
  );
}

/** A red line over the form; renders nothing when empty. */
export function LumenAuthProblem({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** A plain note over the form, such as "New code sent"; renders nothing when empty. */
export function LumenAuthNote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <Alert className="mb-4">
      <Mail />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

interface TextFieldProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  /** The browser's autocomplete hint (`username`, `email`, `current-password`, `new-password`). */
  autoComplete: string;
  label?: string;
}

export function LumenEmailField({
  id,
  value,
  onChange,
  autoComplete,
  label = 'Email',
}: TextFieldProps) {
  const own = useId();
  const fieldId = id ?? own;
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <InputGroup className="h-10">
        <InputGroupAddon>
          <Mail />
        </InputGroupAddon>
        <InputGroupInput
          id={fieldId}
          type="email"
          required
          autoComplete={autoComplete}
          placeholder="you@example.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
    </Field>
  );
}

/** A password box with a Show switch beside it. */
export function LumenPasswordField({
  id,
  value,
  onChange,
  autoComplete,
  label = 'Password',
}: TextFieldProps) {
  const own = useId();
  const fieldId = id ?? own;
  const [show, setShow] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <InputGroup className="h-10">
        <InputGroupAddon>
          <Lock />
        </InputGroupAddon>
        <InputGroupInput
          id={fieldId}
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end" className="border-l bg-muted/50 px-3">
          <label htmlFor={`${fieldId}-show`} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              id={`${fieldId}-show`}
              checked={show}
              onCheckedChange={(v) => setShow(v === true)}
            />{' '}
            Show
          </label>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

/** A one-time code from an email or an authenticator app: digits only, big and spaced. */
export function LumenCodeField({
  id,
  value,
  onChange,
  length = 6,
  error,
  hint,
  onResend,
  resendLabel = 'Send a new code',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  length?: number;
  error?: ReactNode;
  hint?: ReactNode;
  /** Shows a link after the hint that asks for a fresh code. */
  onResend?: () => void;
  resendLabel?: string;
}) {
  const own = useId();
  return (
    <Field data-invalid={error ? true : undefined}>
      <Input
        id={id ?? own}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={'0'.repeat(length)}
        maxLength={length}
        aria-label={`${length}-digit code`}
        className="h-14 text-center font-code text-2xl tracking-[0.6em]"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        aria-invalid={Boolean(error)}
      />
      {error ? <FieldError>{error}</FieldError> : null}
      {(hint || onResend) && (
        <FieldDescription className="text-center">
          {hint}{' '}
          {onResend && (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={onResend}
            >
              {resendLabel}
            </button>
          )}
        </FieldDescription>
      )}
    </Field>
  );
}

/** Progress through a short flow: one bar per step, filled up to `at`, and "Step 2 of 3". */
export function LumenStepBar({ at, of }: { at: number; of: number }) {
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {Array.from({ length: of }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= at ? 'bg-primary' : 'bg-muted'}`}
          />
        ))}
      </div>
      <span className="text-center text-muted-foreground text-xs">
        Step {at} of {of}
      </span>
    </div>
  );
}
