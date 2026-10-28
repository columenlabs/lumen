/**
 * Bearings: a few lines at the top of each message telling the model when and where it is (the time
 * in the person's zone, how long since the chat's last message, the app), so it never guesses
 * "today". Kept out of the system prompt so the prompt cache holds. An app adds its own lines (a
 * market's session, a billing day) through `extras`; each gets `extrasMs` and is left out when it is
 * late or throws, so bearings never hold a turn.
 */

/** What an app's extra lines are worked out from. */
export interface BearingsNow {
  /** The moment, ms since the epoch. */
  now: number;
  /** The person's IANA zone (checked). */
  timeZone: string;
  /** A moment in the person's zone: `Tue, Oct 27, 2026, 3:05 PM PDT`. */
  at: (ms: number) => string;
  /** A span as the model reads it: `1h 55m`, `2d 3h`. */
  span: (ms: number) => string;
}

/** An app's own bearings: lines (or one line) to add, nothing to add none. */
export type BearingsExtra = (
  b: BearingsNow,
) => string | string[] | null | undefined | Promise<string | string[] | null | undefined>;

export interface BearingsInput {
  /** The moment; now by default. */
  now?: number;
  /** The person's IANA zone (the browser's); `fallbackZone` when missing or unknown. */
  timeZone?: string;
  /** UTC by default. */
  fallbackZone?: string;
  /** When this chat's last message was, ms; left out on a new chat. */
  lastAt?: number;
  /** The app's name (`App: …`). */
  app?: string;
  extras?: BearingsExtra | BearingsExtra[];
  /** How long each extra may take; 300 ms. */
  extrasMs?: number;
}

const EXTRAS_MS = 300;

/** `zone` when Intl knows it, else undefined. */
export function knownZone(zone: string | undefined): string | undefined {
  if (!zone || zone.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** A moment in `timeZone`: `Tue, Oct 27, 2026, 3:05 PM PDT`. */
export function bearingTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(ms);
}

/** A span: `45s`, `12m`, `1h 55m`, `2d 3h`. */
export function bearingSpan(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 1) return `${Math.round(Math.abs(ms) / 1000)}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

function ago(ms: number): string {
  const m = ms / 60_000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

async function within(extra: BearingsExtra, b: BearingsNow, ms: number): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ms);
  });
  try {
    const got = await Promise.race([Promise.resolve().then(() => extra(b)), late]);
    if (!got) return [];
    return (Array.isArray(got) ? got : [got]).filter((l) => typeof l === 'string' && l.trim());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** The bearings block, ending in a blank line, to put before the person's message. */
export async function bearings(input: BearingsInput = {}): Promise<string> {
  const now = input.now ?? Date.now();
  const timeZone = knownZone(input.timeZone) ?? knownZone(input.fallbackZone) ?? 'UTC';
  const b: BearingsNow = {
    now,
    timeZone,
    at: (ms) => bearingTime(ms, timeZone),
    span: bearingSpan,
  };
  const utc = new Date(now).toISOString().slice(11, 16);
  const lines = [
    "<bearings> (the server's clock, for you only: use it for today, now and how long ago; never guess the date, and never repeat it in your answer)",
    `Now: ${b.at(now)} (${timeZone}) · ${utc} UTC`,
  ];
  if (input.lastAt && input.lastAt < now)
    lines.push(`Last message in this chat: ${ago(now - input.lastAt)} (${b.at(input.lastAt)})`);
  if (input.app) lines.push(`App: ${input.app}`);
  const extras = input.extras ? (Array.isArray(input.extras) ? input.extras : [input.extras]) : [];
  const more = await Promise.all(extras.map((e) => within(e, b, input.extrasMs ?? EXTRAS_MS)));
  for (const l of more.flat()) lines.push(l.slice(0, 400));
  lines.push('</bearings>');
  return `${lines.join('\n')}\n\n`;
}
