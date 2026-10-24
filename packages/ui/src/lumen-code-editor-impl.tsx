// CodeMirror behind LumenCodeEditor, in its own chunk: loaded the first time an editor opens, so no
// page that only reads code (LumenCode, shiki) pays for it.
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useMemo } from 'react';
import type { LumenCodeEditorProps } from './lumen-code-editor';
import { resolvedTheme, usePrefs } from './prefs';

const LANGS = { js: () => javascript(), sql: () => sql(), json: () => json() };

export default function CodeEditor({
  value,
  onChange,
  lang,
  wrap = false,
  readOnly = false,
  className,
}: LumenCodeEditorProps) {
  const prefs = usePrefs();
  const extensions = useMemo(
    () => [...(lang ? [LANGS[lang]()] : []), ...(wrap ? [EditorView.lineWrapping] : [])],
    [lang, wrap],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={resolvedTheme(prefs) === 'dark' ? githubDark : githubLight}
      extensions={extensions}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      height="100%"
      className={className}
    />
  );
}
