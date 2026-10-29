// LumenPlayer: a recording, video or audio, on the browser's own <video>/<audio> (served with byte
// ranges, so seeking reads only what it needs) with the kit's controls under it: play, back and
// forward 15 s, the seek bar and its times, speed, captions and full screen. Chapters jump; a timed
// transcript lights the line being said, keeps it in view inside its own box and plays from a
// line on a tap. It starts at `start` and reports its place through `onProgress` about every 10 s
// while it plays, on pause and at the end, so an app can save where it was left. A slides source
// is pictures in step with an audio track: the slide shown is the last one whose `at` has passed.
// Keys work only while the player has focus: space or k plays, j and l skip 15 s, ← and → 5 s,
// f full screen, c captions.
import {
  CaptionsIcon,
  GaugeIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './lib/utils';
import { LumenSelector } from './lumen-selector';
import { IconButton } from './page';
import { Slider } from './ui/slider';
import { Spinner } from './ui/spinner';

export interface PlayerTrack {
  /** A WebVTT file. */
  src: string;
  srcLang: string;
  label: string;
  default?: boolean;
}

export interface PlayerChapter {
  /** Seconds from the start. */
  at: number;
  title: string;
}

export interface PlayerLine {
  start: number;
  end?: number;
  text: string;
  /** Who says it, before the line. */
  who?: string;
}

export interface PlayerSlide {
  /** Seconds into the audio when the slide shows. */
  at: number;
  image: string;
  alt?: string;
}

export type PlayerSource = { kind: 'slides'; slides: readonly PlayerSlide[]; audio: string };

export interface LumenPlayerProps {
  /** The recording's address; or `source` for slides over audio. */
  src?: string;
  source?: PlayerSource;
  /** `video` or `audio`; read from the address's extension by default (video when unsure). */
  kind?: 'video' | 'audio';
  /** The recording's name, for screen readers and full screen. */
  title?: string;
  poster?: string;
  /** Captions (video). */
  tracks?: readonly PlayerTrack[];
  chapters?: readonly PlayerChapter[];
  transcript?: readonly PlayerLine[];
  /** Where to start, in seconds (a saved place, or a search hit's minute). */
  start?: number;
  /** The place, about every 10 s while playing, on pause and at the end. */
  onProgress?: (seconds: number, info: { duration: number | null; ended: boolean }) => void;
  onEnded?: () => void;
  /** Plays as soon as it can (the next item of a series, after the last one ended). */
  autoPlay?: boolean;
  className?: string;
}

const SPEEDS = ['0.75', '1', '1.25', '1.5', '1.75', '2'] as const;
const SKIP = 15;
const NUDGE = 5;
const REPORT_MS = 10_000;
/** After a person scrolls the transcript, it stops following for this long. */
const HANDS_OFF_MS = 5_000;
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?|#|$)/i;

/** `1:02`, `1:02:03`. */
export function playerClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The last entry whose time has passed, by binary search over a list sorted by time. */
function lastAt<T>(list: readonly T[], time: (t: T) => number, now: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time(list[mid] as T) <= now) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

export function LumenPlayer({
  src,
  source,
  kind,
  title,
  poster,
  tracks,
  chapters,
  transcript,
  start,
  onProgress,
  onEnded,
  autoPlay,
  className,
}: LumenPlayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const url = source?.kind === 'slides' ? source.audio : (src ?? '');
  const slides = source?.kind === 'slides' ? source.slides : null;
  const video = !slides && (kind ? kind === 'video' : !AUDIO.test(url));
  const [now, setNow] = useState(start ?? 0);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState<string>('1');
  const [captions, setCaptions] = useState(() => !!tracks?.some((t) => t.default));
  const [full, setFull] = useState(false);
  const last = useRef(0);
  const progress = useRef(onProgress);
  progress.current = onProgress;

  const report = (ended = false) => {
    const el = media.current;
    // Opening a recording and leaving it unplayed saves nothing.
    if (!el || !Number.isFinite(el.currentTime) || (!ended && el.currentTime < 1)) return;
    last.current = Date.now();
    progress.current?.(Math.round(el.currentTime), {
      duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
      ended,
    });
  };
  // Leaving the player (closing its drawer) saves the place too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: report reads refs only, once on leave
  useEffect(() => {
    const el = media.current;
    return () => {
      if (el && !el.ended && el.currentTime >= 1) {
        progress.current?.(Math.round(el.currentTime), {
          duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
          ended: false,
        });
      }
    };
  }, [url]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  // Captions follow the toggle once the tracks have loaded.
  useEffect(() => {
    const list = media.current?.textTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t) t.mode = captions && i === 0 ? 'showing' : 'hidden';
    }
  }, [captions]);

  const seek = (s: number, play = false) => {
    const el = media.current;
    if (!el) return;
    const end = Number.isFinite(el.duration) ? el.duration : Number.POSITIVE_INFINITY;
    el.currentTime = Math.min(Math.max(0, s), end);
    setNow(el.currentTime);
    if (play) void el.play().catch(() => {});
  };
  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void root.current?.requestFullscreen?.().catch(() => {});
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // Fields, menus and the seek bar keep their own keys.
    if (t.closest('input, textarea, select, [role="slider"], [role="combobox"], [role="listbox"]'))
      return;
    const here = media.current?.currentTime ?? 0;
    const keys: Record<string, () => void> = {
      ' ': toggle,
      k: toggle,
      j: () => seek(here - SKIP),
      l: () => seek(here + SKIP),
      ArrowLeft: () => seek(here - NUDGE),
      ArrowRight: () => seek(here + NUDGE),
      ...(video ? { f: fullscreen } : {}),
      ...(video && tracks?.length ? { c: () => setCaptions((c) => !c) } : {}),
    };
    const run = keys[e.key];
    // Space on a focused button presses it; the player takes it only on itself or the media.
    if (!run || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && t.closest('button')) return;
    e.preventDefault();
    run();
  };

  const events = {
    ref: media,
    src: url,
    preload: 'metadata' as const,
    playsInline: true,
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => {
      const el = e.currentTarget;
      setFailed(false);
      setDuration(Number.isFinite(el.duration) ? el.duration : null);
      el.playbackRate = Number(rate);
      if (start && start > 0 && (!Number.isFinite(el.duration) || start < el.duration - 1)) {
        el.currentTime = start;
        setNow(start);
      }
      if (autoPlay) void el.play().catch(() => {});
    },
    onDurationChange: (e: SyntheticEvent<HTMLMediaElement>) => {
      const d = e.currentTarget.duration;
      setDuration(Number.isFinite(d) ? d : null);
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => {
      const el = e.currentTarget;
      setNow(el.currentTime);
      if (!el.paused && Date.now() - last.current >= REPORT_MS) report();
    },
    onPlay: () => setPlaying(true),
    onPause: () => {
      setPlaying(false);
      report();
    },
    onWaiting: () => setWaiting(true),
    onPlaying: () => setWaiting(false),
    onCanPlay: () => setWaiting(false),
    onError: () => {
      setWaiting(false);
      setFailed(true);
    },
    onEnded: () => {
      setPlaying(false);
      report(true);
      onEnded?.();
    },
  };

  const slide = slides ? (slides[lastAt(slides, (s) => s.at, now)] ?? slides[0]) : null;
  const chapter = chapters?.length ? lastAt(chapters, (c) => c.at, now) : -1;
  const end = duration ?? 0;

  return (
    <section
      ref={root}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the player takes its keys while focused
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={title ? `${title} player` : 'Player'}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        full && 'justify-center bg-background p-4',
        className,
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-md',
          (video || slides) && 'bg-black',
          full && 'min-h-0 flex-1',
        )}
      >
        {video ? (
          <video
            key={url}
            {...events}
            poster={poster}
            title={title}
            onClick={toggle}
            className={cn('w-full', full ? 'h-full object-contain' : 'aspect-video')}
          >
            {tracks?.map((t) => (
              <track
                key={t.src}
                kind="captions"
                src={t.src}
                srcLang={t.srcLang}
                label={t.label}
                default={t.default}
              />
            ))}
          </video>
        ) : (
          <>
            <audio key={url} {...events} title={title} className="hidden" />
            {slide ? (
              <img
                src={slide.image}
                alt={slide.alt ?? title ?? ''}
                className={cn('w-full object-contain', full ? 'h-full' : 'aspect-video')}
              />
            ) : null}
          </>
        )}
        {waiting && !failed ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Spinner className="size-6 text-white" />
          </span>
        ) : null}
        {failed ? (
          <div
            role="alert"
            className={cn(
              'flex items-center justify-center gap-2 p-4 text-sm',
              video || slides ? 'absolute inset-0 bg-black/70 text-white' : 'text-destructive',
            )}
          >
            <span className="truncate">Could not load this recording</span>
            <IconButton
              icon={RotateCwIcon}
              label="Try again"
              variant="secondary"
              onClick={() => {
                setFailed(false);
                media.current?.load();
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <Slider
          aria-label="Seek"
          min={0}
          max={end || 1}
          step={1}
          value={[Math.min(now, end || 1)]}
          disabled={!end}
          onValueChange={([v]) => v !== undefined && seek(v)}
          className="py-2"
        />
        <div className="flex min-w-0 items-center gap-1">
          <IconButton
            icon={playing ? PauseIcon : PlayIcon}
            label={playing ? 'Pause' : 'Play'}
            variant="default"
            onClick={toggle}
            disabled={failed}
          />
          <IconButton
            icon={RotateCcwIcon}
            label={`Back ${SKIP} seconds`}
            onClick={() => seek(now - SKIP)}
          />
          <IconButton
            icon={RotateCwIcon}
            label={`Forward ${SKIP} seconds`}
            onClick={() => seek(now + SKIP)}
          />
          <span className="num ml-1 min-w-0 truncate text-xs text-muted-foreground">
            {playerClock(now)} / {duration === null ? '–:––' : playerClock(duration)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <LumenSelector
              trigger="chip"
              size="sm"
              icon={GaugeIcon}
              label="Speed"
              value={rate}
              display={<span className="num">{rate}×</span>}
              options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
              search={false}
              align="end"
              onChange={(v) => {
                setRate(v);
                if (media.current) media.current.playbackRate = Number(v);
              }}
            />
            {video && tracks?.length ? (
              <IconButton
                icon={CaptionsIcon}
                label={captions ? 'Hide captions' : 'Show captions'}
                pressed={captions}
                onClick={() => setCaptions((c) => !c)}
              />
            ) : null}
            {video ? (
              <IconButton
                icon={full ? MinimizeIcon : MaximizeIcon}
                label={full ? 'Exit full screen' : 'Full screen'}
                onClick={fullscreen}
              />
            ) : null}
          </span>
        </div>
      </div>

      {!full && chapters?.length ? (
        <PlayerList label="Chapters">
          {chapters.map((c, i) => (
            <PlayerRow
              key={`${c.at}:${c.title}`}
              at={c.at}
              current={i === chapter}
              onPlay={() => seek(c.at, true)}
            >
              {c.title}
            </PlayerRow>
          ))}
        </PlayerList>
      ) : null}
      {!full && transcript?.length ? (
        <Transcript lines={transcript} now={now} playing={playing} onPlay={(s) => seek(s, true)} />
      ) : null}
    </section>
  );
}

function PlayerList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <ol className="flex flex-col">{children}</ol>
    </section>
  );
}

function PlayerRow({
  at,
  current,
  onPlay,
  children,
  wrap,
  index,
}: {
  index?: number;
  at: number;
  current: boolean;
  onPlay: () => void;
  children: ReactNode;
  /** A transcript line reads in full; a chapter's title stays on one line. */
  wrap?: boolean;
}) {
  return (
    <li data-line={index}>
      <button
        type="button"
        onClick={onPlay}
        aria-current={current || undefined}
        className={cn(
          'flex w-full min-w-0 gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          wrap ? 'items-baseline' : 'items-center',
          current && 'bg-accent text-accent-foreground',
        )}
      >
        <time className="num w-14 shrink-0 text-xs text-muted-foreground">{playerClock(at)}</time>
        <span className={cn('min-w-0 flex-1', wrap ? 'break-words' : 'truncate')}>{children}</span>
      </button>
    </li>
  );
}

function Transcript({
  lines,
  now,
  playing,
  onPlay,
}: {
  lines: readonly PlayerLine[];
  now: number;
  playing: boolean;
  onPlay: (seconds: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const touched = useRef(0);
  const at = lastAt(lines, (l) => l.start, now);
  const line = lines[at];
  const current = line && (line.end === undefined || now < line.end) ? at : -1;
  // While it plays, the line being said stays in view inside the box (never the page), unless the
  // person has just scrolled it themselves.
  useEffect(() => {
    const el = box.current;
    if (!playing || current < 0 || !el || Date.now() - touched.current < HANDS_OFF_MS) return;
    const row = el.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!row) return;
    const top = row.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight)
      el.scrollTo({ top: top - el.clientHeight / 3, behavior: 'smooth' });
  }, [current, playing]);
  const mark = () => {
    touched.current = Date.now();
  };
  return (
    <section aria-label="Transcript" className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">Transcript</h3>
      <div
        ref={box}
        onWheel={mark}
        onTouchMove={mark}
        className="relative max-h-[40vh] overflow-y-auto overscroll-contain"
      >
        <ol className="flex flex-col">
          {lines.map((l, i) => (
            <PlayerRow
              key={`${l.start}:${i}`}
              index={i}
              at={l.start}
              current={i === current}
              onPlay={() => onPlay(l.start)}
              wrap
            >
              {l.who ? <span className="font-medium">{l.who}: </span> : null}
              {l.text}
            </PlayerRow>
          ))}
        </ol>
      </div>
    </section>
  );
}
