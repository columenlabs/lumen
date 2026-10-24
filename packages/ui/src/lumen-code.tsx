// The shell's one code block: shiki's light and dark tokens for the fence's
// language, scrolled sideways inside the block, a copy icon. The assistant's answers and scripts and
// An app's playbook files all draw through it, so shiki ships once suite-wide.
import { CheckIcon, CopyIcon } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';

type Highlighter = import('shiki/core').HighlighterCore;
type Token = { content: string; htmlStyle?: Record<string, string> };

/** shiki, created once on first use; each language is its own chunk, loaded the first time it shows. */
let highlighter: Promise<Highlighter> | null = null;
function getHighlighter() {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/** The fence tag or file type shiki knows it by (`ts`, `py`, `sql`), or null for plain text. */
async function loadLang(h: Highlighter, lang: string): Promise<string | null> {
  const id = lang.toLowerCase();
  if (h.getLoadedLanguages().includes(id)) return id;
  const { bundledLanguages } = await import('shiki/langs');
  const load = bundledLanguages[id as keyof typeof bundledLanguages];
  if (!load) return null;
  await h.loadLanguage(load);
  return id;
}

/** A file's language from its name (`playbook.py` → `py`). */
export const langOfPath = (path: string) => path.split('.').pop() ?? '';

/** Lines of shiki tokens for `code`, plain lines until they arrive or when the language is unknown. */
export function useCodeTokens(code: string, lang: string | undefined) {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  useEffect(() => {
    let live = true;
    setTokens(null);
    if (!lang) return;
    getHighlighter().then(async (h) => {
      const id = await loadLang(h, lang);
      if (!live || !id) return;
      const out = h.codeToTokens(code, {
        lang: id,
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });
      setTokens(out.tokens as Token[][]);
    });
    return () => {
      live = false;
    };
  }, [code, lang]);
  return tokens;
}

export type LumenCodeProps = {
  code: string;
  /** The fence tag or file extension; none draws plain text. */
  lang?: string;
  /** Wraps long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** Numbers each line (files); off for chat snippets. */
  lineNumbers?: boolean;
  /** The label and copy icon over the code (chat); off where the page has its own (a file view). */
  header?: boolean;
  className?: string;
};

export function LumenCode({
  code,
  lang,
  wrap = false,
  lineNumbers = false,
  header = true,
  className,
}: LumenCodeProps) {
  const text = code.replace(/\n$/, '');
  const tokens = useCodeTokens(text, lang);
  const [copied, setCopied] = useState(false);
  const lines: Token[][] = tokens ?? text.split('\n').map((l) => [{ content: l }]);
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Couldn't copy the code"),
    );
  return (
    <div
      data-slot="lumen-code"
      data-highlighted={tokens ? 'true' : 'false'}
      className={cn(
        'lumen-code min-w-0 text-xs leading-relaxed',
        wrap && 'lumen-code-wrap',
        lineNumbers && 'lumen-code-numbers',
        header && 'rounded-lg border bg-muted/40',
        className,
      )}
    >
      {header && (
        <div className="flex h-7 items-center justify-between border-b pr-1 pl-3">
          <span className="font-mono text-xs text-muted-foreground">{lang || 'text'}</span>
          <IconButton
            icon={copied ? CheckIcon : CopyIcon}
            label={copied ? 'Copied' : 'Copy code'}
            size="icon-xs"
            onClick={copy}
          />
        </div>
      )}
      <pre className="overflow-x-auto">
        <code>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no other identity
            <span key={i} className="line">
              {line.map((t, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no other identity
                <span key={j} style={t.htmlStyle as CSSProperties | undefined}>
                  {t.content}
                </span>
              ))}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
