// The shell's one code editor: CodeMirror with syntax colour, line numbers
// and an optional wrap, in the GitHub light and dark colours LumenCode reads with. Where LumenCode
// shows code, this edits it; CodeMirror ships once suite-wide, in a chunk of its own.
import { Suspense, lazy } from 'react';
import { cn } from './lib/utils';
import { Skeleton } from './ui/skeleton';

export type LumenCodeLang = 'js' | 'sql' | 'json';

export interface LumenCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  lang?: LumenCodeLang;
  /** Wraps long lines instead of scrolling sideways (off by default). */
  wrap?: boolean;
  readOnly?: boolean;
  className?: string;
}

const Impl = lazy(() => import('./lumen-code-editor-impl'));

export function LumenCodeEditor({ className, ...props }: LumenCodeEditorProps) {
  return (
    <div
      data-slot="lumen-code-editor"
      className={cn('min-h-0 overflow-hidden rounded-lg border text-xs', className)}
    >
      <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
        <Impl {...props} className="lumen-code-editor h-full" />
      </Suspense>
    </div>
  );
}
