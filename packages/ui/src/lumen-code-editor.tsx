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

// Its width comes from where it sits, never from its longest line (contain: inline-size), so a
// long line scrolls inside the editor instead of pushing a drawer or form past its edge.
export function LumenCodeEditor({ className, ...props }: LumenCodeEditorProps) {
  return (
    <div
      data-slot="lumen-code-editor"
      className={cn(
        'min-h-0 w-full min-w-0 max-w-full overflow-hidden rounded-lg border text-xs [contain:inline-size]',
        className,
      )}
    >
      <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
        <Impl {...props} className="lumen-code-editor h-full" />
      </Suspense>
    </div>
  );
}
