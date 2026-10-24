import {
  AlertTriangleIcon,
  CheckIcon,
  ListIcon,
  MessageSquareIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { useAssistant, useAssistantName } from './assistant-context';
// Settings ▸ Schedules: the work an app runs for the person on its own, one
// section for every app. An app passes its schedules (each says how it is shaped: a window, the
// rest of the time, once a day or on report days) and how to save and run one; the shell draws the
// list and the editor sheet. An app without schedules adds no section. The assistant briefs are schedules too: ✦ rows with their instructions, spend cap and Notify switch, ＋ Brief
// to add one, and their last run's chat opens in the assistant.
import { LumenConfirm } from './confirm';
import { useIsMobile } from './hooks/use-mobile';
import { LumenSelector } from './lumen-selector';
import { IconButton } from './page';
import { usePrefs } from './prefs';
import { useShell } from './shell';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import { Skeleton } from './ui/skeleton';
import { Switch } from './ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Textarea } from './ui/textarea';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

export interface ScheduleRun {
  at: string;
  ok: boolean;
  detail: string;
}
/** One schedule as an app's API returns it. */
export interface ScheduleItem {
  id: string;
  name: string;
  on: boolean;
  /** Minutes between runs. */
  every: number;
  /** `HH:MM`: the window's start (`window`) or the time of day (`daily`). */
  from: string;
  /** `HH:MM`: the window's end (`window`). */
  to: string;
  /** Days it runs, 0 = Sunday (`window`). */
  days: number[];
  tz: string;
  /** `window`: a window and days; `outside`: whenever a window is closed; `daily`: once a day; `reports`: on report days. */
  kind: 'window' | 'outside' | 'daily' | 'reports';
  /** The Every choices in minutes (none: it runs once a day). */
  choices: number[];
  /** Fixed words for when it runs, for kinds whose times can't be changed. */
  when?: string;
  /** What it does: the data it inspects, processing, enrichment, output and cost. */
  about: {
    inspects: string;
    processes: string;
    enriches?: string;
    outputs: string;
    cost?: string;
  };
  last: ScheduleRun | null;
  next: string | null;
  /** Why it can't run now (a service not connected). */
  waiting: string | null;
  /** A the assistant brief: what it asks, its spend cap, Notify and its last run's chat. */
  brief?: {
    /** `outlook`: the market outlook, whose instructions are fixed; `brief`: the person's own. */
    kind: 'outlook' | 'brief';
    instructions: string;
    cap_usd: number;
    notify: boolean;
    last: { chat: string; usd: number } | null;
  };
}
export type ScheduleChange = Partial<
  Pick<ScheduleItem, 'on' | 'every' | 'from' | 'to' | 'days' | 'tz'>
>;
export interface BriefChange {
  instructions?: string;
  cap_usd?: number;
  notify?: boolean;
}
/** How an app saves, adds and removes the assistant briefs (each change returns once the list is fresh). */
export interface BriefActions {
  save: (id: string, change: BriefChange) => Promise<void>;
  /** Adds a brief; returns its schedule's id. */
  create: (brief: { name: string; instructions: string }) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'UTC',
];

const everyText = (m: number) => (m >= 1440 ? '1 day' : m >= 60 ? `${m / 60} h` : `${m} min`);
/** `13:00` → `1:00 PM`. */
const clockText = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const daysText = (days: number[]) => {
  const d = [...days].sort();
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  return d.map((x) => DAYS[x]).join(', ');
};
const zoneText = (tz: string) => tz.split('/').pop()?.replace('_', ' ') ?? tz;

/** When it runs, in words. */
function when(s: ScheduleItem) {
  if (s.when) return s.when;
  if (s.kind === 'window')
    return `${daysText(s.days)} ${clockText(s.from)}–${clockText(s.to)} ${zoneText(s.tz)}`;
  return `Daily at ${clockText(s.from)} ${zoneText(s.tz)}`;
}

function useTime() {
  const { timeZone } = usePrefs();
  return (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
}

function Last({ s, compact = false }: { s: ScheduleItem; compact?: boolean }) {
  const time = useTime();
  if (!s.last) return <span className="text-muted-foreground">Not yet</span>;
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${s.last.ok ? '' : 'text-loss'}`}>
      {s.last.ok ? (
        <CheckIcon className="size-3.5 shrink-0 text-gain" />
      ) : (
        <AlertTriangleIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate" title={s.last.detail}>
        {compact ? time(s.last.at) : `${time(s.last.at)} · ${s.last.detail}`}
      </span>
    </span>
  );
}

type Save = (id: string, change: ScheduleChange) => Promise<void>;
/** Opens the app's Logs filtered to one schedule's runs. */
type Runs = (id: string) => void;
/** The app's view of one schedule's newest runs (from its Logs). */
type Recent = (id: string) => ReactNode;

function OnSwitch({ s, onSave }: { s: ScheduleItem; onSave: Save }) {
  const [pending, setPending] = useState(false);
  return (
    <Switch
      aria-label={`${s.name} on`}
      checked={s.on}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(on) => {
        setPending(true);
        void onSave(s.id, { on }).finally(() => setPending(false));
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** At (a daily schedule), Days and Time zone: the schedule editor's and New brief's. */
function TimeFields({
  kind,
  draft,
  set,
}: {
  kind: 'window' | 'daily';
  draft: ScheduleChange;
  set: (c: ScheduleChange) => void;
}) {
  const zones = !draft.tz || ZONES.includes(draft.tz) ? ZONES : [draft.tz, ...ZONES];
  return (
    <>
      {kind === 'daily' ? (
        <Row label="At">
          <Input
            type="time"
            aria-label="At"
            className="num w-32"
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </Row>
      ) : null}
      <Row label="Days">
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          spacing={1}
          className="w-full"
          value={(draft.days ?? []).map(String)}
          onValueChange={(v) => v.length && set({ days: v.map(Number) })}
        >
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <ToggleGroupItem key={d} value={String(d)} className="flex-1 px-0">
              {DAYS[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row label="Time zone">
        <LumenSelector
          label="Time zone"
          className="w-full"
          options={zones.map((z) => ({ value: z, label: z.replace('_', ' ') }))}
          value={draft.tz}
          onChange={(tz) => set({ tz })}
        />
      </Row>
    </>
  );
}

/** One schedule's settings, with Run now. */
function Editor({
  s,
  onSave,
  onRun,
  onRuns,
  recent,
  briefs,
  onClose,
}: {
  s: ScheduleItem;
  onSave: Save;
  onRun: (id: string) => Promise<ScheduleRun | null>;
  onRuns?: Runs;
  recent?: Recent;
  briefs?: BriefActions;
  onClose: () => void;
}) {
  const assistantName = useAssistantName();
  const time = useTime();
  const assistant = useAssistant();
  const { closeSettings } = useShell();
  const [brief, setBrief] = useState<BriefChange>({
    instructions: s.brief?.instructions,
    cap_usd: s.brief?.cap_usd,
    notify: s.brief?.notify,
  });
  const [confirm, setConfirm] = useState(false);
  const own = s.brief?.kind === 'brief';
  const last = s.brief?.last;
  const [draft, setDraft] = useState<ScheduleChange>({
    on: s.on,
    every: s.every,
    from: s.from,
    to: s.to,
    days: s.days,
    tz: s.tz,
  });
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState<ScheduleRun | null>(null);
  const set = (c: ScheduleChange) => setDraft((d) => ({ ...d, ...c }));
  const act = async (what: 'save' | 'run') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'save') {
        if (s.brief && briefs) {
          const changed: BriefChange = {
            ...(own && brief.instructions?.trim() !== s.brief.instructions
              ? { instructions: brief.instructions?.trim() }
              : {}),
            ...(brief.cap_usd !== s.brief.cap_usd ? { cap_usd: brief.cap_usd } : {}),
            ...(brief.notify !== s.brief.notify ? { notify: brief.notify } : {}),
          };
          if (Object.keys(changed).length) await briefs.save(s.id, changed);
        }
        await onSave(s.id, draft);
        onClose();
      } else setRan(await onRun(s.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <SheetHeader>
        <SheetTitle>{s.name}</SheetTitle>
        <SheetDescription>{when(s)}</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-1 gap-5 overflow-y-auto px-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {(
            [
              ['Inspects', s.about.inspects],
              ['Processes', s.about.processes],
              ['Enriches', s.about.enriches],
              ['Outputs', s.about.outputs],
              ['Cost', s.about.cost],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
        </dl>
        {s.brief ? (
          <Row label="Instructions">
            {own ? (
              <Textarea
                aria-label="Instructions"
                rows={5}
                maxLength={4000}
                value={brief.instructions ?? ''}
                onChange={(e) => setBrief((b) => ({ ...b, instructions: e.target.value }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{s.brief.instructions}</p>
            )}
          </Row>
        ) : null}
        <div className="flex items-center justify-between">
          <Label htmlFor="sched-on">On</Label>
          <Switch id="sched-on" checked={draft.on} onCheckedChange={(on) => set({ on })} />
        </div>
        {s.choices.length ? (
          <Row label="Every">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={String(draft.every)}
              onValueChange={(v) => v && set({ every: Number(v) })}
            >
              {s.choices.map((m) => (
                <ToggleGroupItem key={m} value={String(m)} className="num">
                  {everyText(m)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Row>
        ) : null}
        {s.kind === 'window' ? (
          <>
            <Row label="Window">
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label="From"
                  className="num w-32"
                  value={draft.from}
                  onChange={(e) => set({ from: e.target.value })}
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label="To"
                  className="num w-32"
                  value={draft.to}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </div>
            </Row>
          </>
        ) : null}
        {s.kind === 'window' || s.kind === 'daily' ? (
          <TimeFields kind={s.kind} draft={draft} set={set} />
        ) : null}
        {s.brief ? (
          <>
            <Row label="Spend cap a run">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  aria-label="Spend cap a run, USD"
                  className="num w-24"
                  min={0.05}
                  max={5}
                  step={0.05}
                  value={brief.cap_usd ?? ''}
                  onChange={(e) => setBrief((b) => ({ ...b, cap_usd: Number(e.target.value) }))}
                />
              </div>
            </Row>
            <div className="flex items-center justify-between">
              <Label htmlFor="brief-notify">Notify when ready</Label>
              <Switch
                id="brief-notify"
                checked={brief.notify ?? false}
                onCheckedChange={(notify) => setBrief((b) => ({ ...b, notify }))}
              />
            </div>
          </>
        ) : null}
        {s.waiting ? (
          <p className="text-sm text-warning">{s.waiting}</p>
        ) : s.next ? (
          <p className="text-sm text-muted-foreground">Next run {time(s.next)}</p>
        ) : null}
        {recent && !ran ? (
          <Row label="Last runs">{recent(s.id)}</Row>
        ) : (
          <Row label="Last run">
            <span className="text-sm">
              <Last s={ran ? { ...s, last: ran } : s} />
            </span>
          </Row>
        )}
        {last && assistant ? (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              assistant.loadChat(last.chat);
              assistant.setOpen(true);
              onClose();
              closeSettings();
            }}
          >
            <MessageSquareIcon />
            Open last run in {assistantName} · <span className="num">${last.usd.toFixed(2)}</span>
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-loss">
            {error}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end">
        {own && briefs ? (
          <>
            <IconButton
              icon={Trash2Icon}
              label="Delete brief"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => setConfirm(true)}
            />
            <LumenConfirm
              open={confirm}
              onOpenChange={setConfirm}
              title={`Delete ${s.name.replace(/^✦ /, '')}?`}
              description={`Its schedule stops. Chats from its runs stay in ${assistantName}.`}
              onConfirm={() => {
                setBusy('save');
                void briefs
                  .remove(s.id)
                  .then(onClose)
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(null));
              }}
            />
          </>
        ) : null}
        {onRuns ? (
          <IconButton
            icon={ListIcon}
            label="All runs"
            variant="outline"
            className="mr-auto"
            onClick={() => onRuns(s.id)}
          />
        ) : null}
        <IconButton
          icon={busy === 'run' ? RefreshCwIcon : PlayIcon}
          busy={busy === 'run'}
          label={busy === 'run' ? 'Running…' : 'Run now'}
          variant="outline"
          disabled={busy !== null || Boolean(s.waiting)}
          onClick={() => void act('run')}
        />
        <Button size="sm" disabled={busy !== null} onClick={() => void act('save')}>
          <CheckIcon />
          Save
        </Button>
      </SheetFooter>
    </>
  );
}

/** The Settings ▸ Schedules section's body. */
export function SchedulesSection({
  schedules,
  error,
  onSave,
  onRun,
  onRuns,
  recent,
  briefs,
}: {
  /** Undefined while loading. */
  schedules?: ScheduleItem[];
  error?: string | null;
  onSave: Save;
  /** Runs it now; returns the run. */
  onRun: (id: string) => Promise<ScheduleRun | null>;
  /** Opens Logs filtered to a schedule's runs; adds Runs buttons. */
  onRuns?: Runs;
  /** Draws a schedule's newest runs in its editor (else its last run). */
  recent?: Recent;
  /** The assistant briefs: their own fields in the editor, and ＋ Brief. */
  briefs?: BriefActions;
}) {
  const isMobile = useIsMobile();
  const { closeSettings } = useShell();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Logs is a page: close the editor and Settings on the way there.
  const toRuns: Runs | undefined = onRuns
    ? (id) => {
        setOpen(null);
        closeSettings();
        onRuns(id);
      }
    : undefined;
  const editing = schedules?.find((s) => s.id === open);
  const { timeZone } = usePrefs();
  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!schedules) return <Skeleton className="h-48 w-full" />;
  return (
    <>
      {isMobile ? (
        <div className="grid grid-cols-1 divide-y rounded-lg border">
          {schedules.map((s) => (
            <button
              key={s.id}
              type="button"
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-3 text-left hover:bg-muted/50"
              onClick={() => setOpen(s.id)}
            >
              <span className="font-medium">{s.name}</span>
              <OnSwitch s={s} onSave={onSave} />
              <span className="col-span-2 text-xs text-muted-foreground">
                {s.kind === 'daily' ? '' : `Every ${everyText(s.every)} · `}
                {when(s)}
              </span>
              <span className="col-span-2 text-xs">
                {s.waiting ? <span className="text-warning">{s.waiting}</span> : <Last s={s} />}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">On</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Last run</TableHead>
                {onRuns ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s.id)}>
                  <TableCell>
                    <OnSwitch s={s} onSave={onSave} />
                  </TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
                    {s.kind === 'daily' ? '' : `Every ${everyText(s.every)} · `}
                    {when(s)}
                  </TableCell>
                  <TableCell className="max-w-48">
                    {s.waiting ? (
                      <Badge variant="outline" className="text-warning" title={s.waiting}>
                        Not connected
                      </Badge>
                    ) : (
                      <Last s={s} compact />
                    )}
                  </TableCell>
                  {onRuns ? (
                    <TableCell>
                      <IconButton
                        icon={ListIcon}
                        label={`${s.name} runs`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toRuns?.(s.id);
                        }}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Times shown in {timeZone.replace('_', ' ')}.{onRuns ? ' Each run is a line in Logs.' : ''}
        </p>
        {briefs ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            Brief
          </Button>
        ) : null}
      </div>
      {briefs ? (
        <Sheet open={adding} onOpenChange={setAdding}>
          <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-4">
            <NewBrief
              create={async (b, time) => {
                const id = await briefs.create(b);
                await onSave(id, time);
                return id;
              }}
              onDone={() => setAdding(false)}
            />
          </SheetContent>
        </Sheet>
      ) : null}
      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-4">
          {editing ? (
            <Editor
              key={editing.id}
              s={editing}
              onSave={onSave}
              onRun={onRun}
              onRuns={toRuns}
              recent={recent}
              briefs={briefs}
              onClose={() => setOpen(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** ＋ Brief: a name, what the assistant should work out, and when (daily at 8:00 AM Pacific on weekdays to start). */
function NewBrief({
  create,
  onDone,
}: {
  create: (b: { name: string; instructions: string }, time: ScheduleChange) => Promise<string>;
  onDone: (id: string | null) => void;
}) {
  const assistantName = useAssistantName();
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [time, setTime] = useState<ScheduleChange>({
    from: '08:00',
    days: [1, 2, 3, 4, 5],
    tz: 'America/Los_Angeles',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await create({ name: name.trim(), instructions: instructions.trim() }, time));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SheetHeader>
        <SheetTitle>New brief</SheetTitle>
        <SheetDescription>
          {assistantName} works it out on a schedule, reads only, and sends it when it is ready.
        </SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-1 gap-5 overflow-y-auto px-4">
        <Row label="Name">
          <Input
            aria-label="Name"
            maxLength={60}
            placeholder="Options brief"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Row>
        <Row label="Instructions">
          <Textarea
            aria-label="Instructions"
            rows={6}
            maxLength={4000}
            placeholder={`What ${assistantName} should look at and report, e.g. my short options expiring this week with their delta and P&L.`}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Row>
        <TimeFields kind="daily" draft={time} set={(c) => setTime((t) => ({ ...t, ...c }))} />
        {error ? (
          <p role="alert" className="text-xs text-loss">
            {error}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button
          size="sm"
          disabled={busy || !name.trim() || !instructions.trim()}
          onClick={() => void add()}
        >
          <PlusIcon />
          Add brief
        </Button>
      </SheetFooter>
    </>
  );
}
