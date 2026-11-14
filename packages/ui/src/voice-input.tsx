// VoiceButton: talk instead of type. A mic beside any text box that writes what the person says into
// it as they speak, through the browser's own speech recognition (Web Speech API): no server of ours,
// no cost. Tap to start, tap to stop; the words join what is already in the box, never replace it.
// Where the browser has no speech recognition (Firefox) the button is not drawn.
import { MicIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { lumenToast } from './lumen-toast';

/** The slice of the Web Speech API this uses (not in TypeScript's DOM types). */
type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

const recognitionClass = (): RecognitionClass | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** True where the browser can turn speech into text. */
export const voiceSupported = () => !!recognitionClass();

/** What each recognition error means, in plain words. Errors left out (`aborted`, `no-speech`) say nothing. */
const ERRORS: Record<string, string> = {
  'not-allowed':
    "The microphone is blocked. Allow it for this site in your browser's settings, then tap the mic again.",
  'service-not-allowed':
    'This browser does not allow speech to text here. Try Chrome, Edge or Safari, or type instead.',
  'audio-capture': 'No microphone was found. Connect one, then tap the mic again.',
  network: 'Speech to text needs an internet connection. Check it, then tap the mic again.',
  'language-not-supported': "Speech to text doesn't support your browser's language yet.",
};

/** `base` and `spoken` joined by one space, unless either side already has it. */
const join = (base: string, spoken: string) => {
  const s = spoken.trim();
  if (!s) return base;
  if (!base || /\s$/.test(base)) return base + s;
  return `${base} ${s}`;
};

export type VoiceInputOptions = {
  /** The box's text now. Speech joins the end of it. */
  value: string;
  /** Gets the box's whole new text: what was there plus what was said, the words still being heard included. */
  onChange: (value: string) => void;
  /** Recognition language as a BCP 47 tag; the browser's language by default. */
  lang?: string;
};

/**
 * Speech to text into a text box: `listening`, `supported` and `toggle()`. While listening, each word
 * heard goes into the box as `onChange(text)` (live, then settled). If the person types while it
 * listens, what they typed is kept and later speech joins after it.
 */
export function useVoiceInput({ value, onChange, lang }: VoiceInputOptions) {
  const supported = useSyncExternalStore(noop, voiceSupported, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // Latest props, read from the recognition's callbacks.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  // The text before this stretch of speech, the first result that belongs to it, and what was last written.
  const base = useRef('');
  const from = useRef(0);
  // Every text written this stretch: the box may not have re-rendered with the last one yet.
  const wrote = useRef(new Set<string>());

  const stop = useCallback(() => rec.current?.stop(), []);
  // Leaving the page (or the box) ends listening, so the mic is never left on.
  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
    const Class = recognitionClass();
    if (!Class || rec.current) return;
    const r = new Class();
    r.lang = lang ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '';
    r.continuous = true;
    r.interimResults = true;
    base.current = latest.current.value;
    from.current = 0;
    wrote.current.clear();
    r.onresult = (e) => {
      const now = latest.current.value;
      // Typed into the box since the last words: keep that text and start the next words after it.
      if (wrote.current.size && !wrote.current.has(now)) {
        base.current = now;
        from.current = e.resultIndex;
        wrote.current.clear();
      }
      let spoken = '';
      for (let i = from.current; i < e.results.length; i++) {
        spoken += ` ${e.results[i]?.[0]?.transcript ?? ''}`;
      }
      const next = join(base.current, spoken.replace(/\s+/g, ' '));
      wrote.current.add(next);
      if (next !== now) latest.current.onChange(next);
    };
    r.onerror = (e) => {
      const message = ERRORS[e.error];
      if (message) lumenToast.error(message, { id: 'lumen-voice' });
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      lumenToast.error('Speech to text could not start. Try again.', { id: 'lumen-voice' });
    }
  }, [lang]);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);
  return { supported, listening, start, stop, toggle };
}

const noop = () => () => {};

export type VoiceButtonProps = VoiceInputOptions & {
  /** `icon-xs` beside a composer's other tools; `icon-sm` by default. */
  size?: 'icon-xs' | 'icon-sm' | 'icon';
  disabled?: boolean;
  className?: string;
};

/**
 * The mic beside a text box: tap to talk, tap again to stop. While it listens the icon turns into a
 * red dot and the words appear in the box as they are heard. Draws nothing where the browser has no
 * speech to text.
 */
export function VoiceButton({
  size = 'icon-sm',
  disabled,
  className,
  ...options
}: VoiceButtonProps) {
  const { supported, listening, toggle, stop } = useVoiceInput(options);
  useEffect(() => {
    if (disabled && listening) stop();
  }, [disabled, listening, stop]);
  if (!supported) return null;
  return (
    <IconButton
      icon={listening ? ListeningDot : MicIcon}
      label={listening ? 'Stop listening' : 'Talk to type'}
      size={size}
      variant="ghost"
      aria-pressed={listening}
      data-voice={listening ? 'listening' : 'idle'}
      disabled={disabled}
      className={cn(listening && 'text-destructive', className)}
      onClick={toggle}
    />
  );
}

/** A red dot that pulses while the mic listens. */
function ListeningDot({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-4 place-items-center', className)} aria-hidden>
      <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
    </span>
  );
}
