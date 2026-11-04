import type { FrameData, FrameRun, FrameScript } from '@columenlabs/lumen-ui-types/frames';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayIcon, RotateCcwIcon, WrapTextIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiJson } from './api-fetch';
import { useAssistantName } from './assistant-context';
import { runBrowserFrame } from './browser-runner';
// A frame's Script editor: the one script that makes an assistant's table (a call as
// JSON, SQL, or JavaScript), as code the person reads and edits, in a dialog off the card's signal
// dot or ⋯ menu. Run and save runs the edited script once as the person, with the read tools the
// assistant may use; it becomes the frame's script only when it works, and a failure shows here.
import { LumenCodeEditor, type LumenCodeLang } from './lumen-code-editor';
import { lumenToast } from './lumen-toast';
import { IconButton } from './page';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Skeleton } from './ui/skeleton';
import { Spinner } from './ui/spinner';
import { WORKSPACES_KEY, frameKey } from './workspace-keys';

const json = <T,>(url: string, init?: RequestInit) => apiJson<T>(url, init, 'workspaces');

interface ScriptRead {
  script: FrameScript | null;
}

/** The script as the text the editor shows, and its language. */
function scriptText(s: FrameScript): { text: string; lang: LumenCodeLang } {
  if (s.kind === 'script') return { text: s.code, lang: 'js' };
  if (s.kind === 'sql') return { text: s.query, lang: 'sql' };
  if (s.kind === 'fetch') {
    const { kind: _k, ...reads } = s;
    return { text: JSON.stringify(reads, null, 2), lang: 'json' };
  }
  return { text: JSON.stringify({ fn: s.fn, args: s.args }, null, 2), lang: 'json' };
}

/** The edited text back as a script; a call that is not JSON says where. */
function parseScript(was: FrameScript, text: string): FrameScript {
  // A browser script keeps where it runs and the reads it starts with.
  if (was.kind === 'script') return { ...was, code: text };
  if (was.kind === 'sql') return { kind: 'sql', query: text };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`The recipe is not valid JSON: ${(e as Error).message}`);
  }
  const o = (v ?? {}) as Record<string, unknown>;
  if (was.kind === 'fetch') return { ...(o as object), kind: 'fetch' } as FrameScript;
  return {
    kind: 'call',
    fn: String(o.fn ?? ''),
    args: (o.args ?? {}) as Record<string, unknown>,
  };
}

export function FrameScriptDialog({
  api,
  frame,
  name,
  runs,
  open,
  onOpenChange,
}: {
  api: string;
  frame: string;
  name: string;
  /** The last runs, newest first: when, how many rows, how long, who, and why one failed. */
  runs?: FrameRun[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const assistant = useAssistantName();
  const read = useQuery({
    queryKey: [...frameKey(api, frame), 'script'],
    queryFn: () => json<ScriptRead>(`${api}/frames/${frame}/script`),
    enabled: open,
    staleTime: 0,
  });
  const script = read.data?.script ?? null;
  const [text, setText] = useState('');
  // Unwrapped by default: long lines scroll sideways like a code editor.
  const [wrap, setWrap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = useMemo(() => (script ? scriptText(script).text : ''), [script]);
  useEffect(() => {
    if (!open) return;
    setText(original);
    setError(null);
  }, [open, original]);
  const save = useMutation({
    // A browser script is kept first (the server runs no code), then run here and its rows saved.
    mutationFn: async (next: FrameScript) => {
      const kept = await json<FrameData>(`${api}/frames/${frame}/script`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ script: next }),
      });
      return kept.meta.browser ? runBrowserFrame(api, frame) : kept;
    },
    onSuccess: (data) => {
      qc.setQueryData(frameKey(api, frame), data);
      void qc.invalidateQueries({ queryKey: [...frameKey(api, frame), 'script'] });
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'ws'] });
      lumenToast.success(`Ran your script: ${data.meta.rows.toLocaleString('en-US')} rows, saved`);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const lang = script ? scriptText(script).lang : undefined;
  const changed = text !== original;
  const run = () => {
    if (!script) return;
    setError(null);
    try {
      save.mutate(parseScript(script, text));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Script · {name}</DialogTitle>
          <DialogDescription>
            {script?.kind === 'script' && script.runtime === 'browser'
              ? 'Runs in your browser, in a sandbox, to make these rows.'
              : `What ${assistant} runs to make these rows. Saved only if it runs.`}
          </DialogDescription>
        </DialogHeader>
        {read.isPending ? (
          <Skeleton className="min-h-0 flex-1" />
        ) : read.error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn't read the script</AlertTitle>
            <AlertDescription>{read.error.message}</AlertDescription>
          </Alert>
        ) : !script ? (
          <Alert>
            <AlertTitle>No script</AlertTitle>
            <AlertDescription>
              {assistant} wrote these rows once: nothing runs to make them.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1">
              {lang && (
                <Badge variant="secondary" className="font-mono">
                  {lang}
                </Badge>
              )}
              <IconButton
                icon={WrapTextIcon}
                label={wrap ? 'Stop wrapping lines' : 'Wrap long lines'}
                pressed={wrap}
                onClick={() => setWrap(!wrap)}
              />
            </div>
            <LumenCodeEditor
              className="flex-1"
              value={text}
              lang={lang}
              wrap={wrap}
              onChange={setText}
            />
            {runs && runs.length > 0 && <RunList runs={runs} assistant={assistant} />}
            {error && (
              <Alert variant="destructive" className="max-h-32 overflow-y-auto">
                <AlertTitle>Didn't save</AlertTitle>
                <AlertDescription className="break-words font-mono text-xs">
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
        <DialogFooter>
          <IconButton
            icon={RotateCcwIcon}
            label="Undo my changes"
            disabled={!changed || save.isPending}
            onClick={() => {
              setText(original);
              setError(null);
            }}
          />
          <Button disabled={!script || save.isPending} onClick={run}>
            {save.isPending ? <Spinner /> : <PlayIcon />} Run and save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The frame's last runs, one line each; a failure's reason in its hover. */
function RunList({ runs, assistant }: { runs: FrameRun[]; assistant: string }) {
  return (
    <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto text-xs text-muted-foreground">
      {runs.map((r) => (
        <li key={r.at} className="flex min-w-0 items-center gap-2" title={r.error}>
          <span
            className={`size-1.5 shrink-0 rounded-full ${r.ok ? 'bg-[var(--meter-ok)]' : 'bg-destructive'}`}
          />
          <time className="shrink-0" dateTime={r.at}>
            {new Date(r.at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
          <span className="num shrink-0">
            {r.ok ? `${r.rows.toLocaleString('en-US')} rows` : 'failed'}
          </span>
          <span className="num shrink-0">{(r.ms / 1000).toFixed(1)} s</span>
          <span className="min-w-0 truncate">
            {r.ok ? `by ${r.by === 'you' ? 'you' : assistant}` : r.error}
          </span>
        </li>
      ))}
    </ul>
  );
}
