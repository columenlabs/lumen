import type { YourColumn } from '@columenlabs/lumen-types/frames';
// + Add column (Edits in place): the two small dialogs the header's + opens
// in place of Edit view. Formula is the same editor and check as Edit view's; Your data names a
// column the person types into, kept as their own frame (joins.tsx `useYourData`).
import type { ViewFormula } from '@columenlabs/lumen-types/views';
import { HashIcon, TypeIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAssistantName } from './assistant-context';
import { SaveButton } from './form-issues';
import { LumenSelector } from './lumen-selector';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { FormulaForm, formulaIssueTarget, formulaIssues, formulaOptions } from './view-formulas';
import type { ViewDomain } from './view-model';

/** A new formula column: label, key, expression, format and roll-up, checked before Add. */
export function AddFormulaDialog<T>({
  open,
  onOpenChange,
  domain,
  formulas,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The domain with its join fields (not its formulas), for the keys a formula can read. */
  domain: ViewDomain<T>;
  /** The view's formulas so far: their keys are taken, and readable. */
  formulas: ViewFormula[];
  onAdd: (formula: ViewFormula) => void;
}) {
  const fieldKeys = domain.fields.map((f) => f.key);
  const fresh = (): ViewFormula => {
    let n = formulas.length + 1;
    while ([...fieldKeys, ...formulas.map((f) => f.key)].includes(`formula_${n}`)) n++;
    return { key: `formula_${n}`, label: `Formula ${n}`, expr: '', format: 'number', agg: null };
  };
  const [draft, setDraft] = useState<ViewFormula>(fresh);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh draft each time it opens
  useEffect(() => {
    if (open) setDraft(fresh());
  }, [open]);
  const issue = formulaIssues([...formulas, draft], domain)[formulas.length] ?? null;
  const readable = formulaOptions(domain, formulas);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 [--dialog-pad:0px] sm:max-w-2xl max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:rounded-none">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">Add a formula column</DialogTitle>
          <DialogDescription>
            A column computed from the other columns, like weight or upside. Saved with the view.
          </DialogDescription>
        </DialogHeader>
        {/* The form scrolls between the header and the footer, so Add column stays in reach on a phone. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FormulaForm
            formula={draft}
            issue={issue}
            fields={readable}
            onChange={(p) => setDraft({ ...draft, ...p })}
          />
        </div>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SaveButton
            label="Add column"
            icon={null}
            issues={
              issue
                ? [
                    {
                      where: `Formula ${draft.label || draft.key}`,
                      message: issue,
                      target: formulaIssueTarget(draft.key, issue),
                    },
                  ]
                : []
            }
            onSave={() => onAdd(draft)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A Your data column: its name and whether it holds numbers or text. */
export function YourDataDialog({
  open,
  onOpenChange,
  keyLabel,
  busy,
  error,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What a row is keyed by: `symbol` or `account`, for the line under the form. */
  keyLabel: string;
  busy?: boolean;
  error?: string | null;
  onAdd: (column: YourColumn) => void;
}) {
  const assistantName = useAssistantName();
  const [label, setLabel] = useState('');
  const [type, setType] = useState<YourColumn['type']>('number');
  useEffect(() => {
    if (open) {
      setLabel('');
      setType('number');
    }
  }, [open]);
  const ok = label.trim().length > 0 && label.trim().length <= 40;
  const submit = () => {
    if (ok && !busy) onAdd({ label: label.trim(), type });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add your own column</DialogTitle>
          <DialogDescription>
            A column you type into, cell by cell. It stays on every {keyLabel} across your cards,
            and {assistantName} reads it but never writes over it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="yours-label">Name</Label>
            <Input
              id="yours-label"
              autoFocus
              value={label}
              maxLength={40}
              placeholder="My target"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Holds</Label>
            <LumenSelector
              options={[
                { value: 'number', label: 'Numbers', icon: HashIcon },
                { value: 'text', label: 'Text', icon: TypeIcon },
              ]}
              value={type}
              onChange={(v) => setType(v as YourColumn['type'])}
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!ok || busy}>
              Add column
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
