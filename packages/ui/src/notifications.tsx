import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellIcon,
  CheckIcon,
  MailIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WebhookIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
// Settings ▸ Notifications: where the product tells the person something
// happened: email to the sign-in address, ntfy (a private ntfy.sh topic per person, sent with their
// own paid ntfy.sh token) and webhooks, then which event goes to which target. The app passes its
// API base (`/api/notifications`), its product's name and the address email comes from.
import { LumenConfirm } from './confirm';
import { LumenExpandRow } from './expand-list';
import { fetchWithin } from './fetch-within';
import { ErrorLine, type KeyTestResult } from './integrations';
import { IconButton } from './page';
import {
  SettingActions,
  SettingField,
  SettingStatus,
  SettingValue,
  settingHealth,
} from './setting-parts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';

type EmailStatus =
  | { available: boolean; connected: false }
  | {
      available: boolean;
      connected: true;
      address: string;
      created_at: string;
      last_test: KeyTestResult | null;
    };
type NtfyStatus =
  | { connected: false }
  | {
      connected: true;
      server: string;
      topic: string;
      /** The person's ntfy.sh access token, masked; null until they add one. */
      token: string | null;
      created_at: string;
      last_test: KeyTestResult | null;
    };
interface WebhookTarget {
  id: string;
  name: string;
  /** Masked: origin and the path's last characters. */
  url: string;
  headers: { name: string; value: string }[];
  created_at: string;
  last_test: KeyTestResult | null;
}
/** One event and the targets (`ntfy`, `email` or a webhook id) it is turned off for. */
interface NotifyEvent {
  key: string;
  label: string;
  detail: string;
  off: string[];
  /** Events with the same group sit together under its label, in the order the groups first appear. */
  group?: string;
}
interface NotificationsStatus {
  email: EmailStatus;
  ntfy: NtfyStatus;
  webhooks: WebhookTarget[];
  events: NotifyEvent[];
}

const NTFY_IOS = 'https://apps.apple.com/us/app/ntfy/id1625396347';
const NTFY_ANDROID = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetchWithin(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

/** The section's data and its writes; every write answers with the new state. */
function useNotifications(api: string, product: string, sender: string) {
  const qc = useQueryClient();
  const key = ['notifications', api];
  const q = useQuery({ queryKey: key, queryFn: () => call<NotificationsStatus>(api) });
  const set = (data: NotificationsStatus) => qc.setQueryData(key, data);
  const reload = () => qc.invalidateQueries({ queryKey: key });
  const send = (method: string, path: string, body?: unknown) =>
    call<NotificationsStatus>(
      `${api}${path}`,
      method,
      body ?? (method === 'DELETE' ? undefined : {}),
    );
  return { q, set, reload, send, product, sender };
}
type Api = ReturnType<typeof useNotifications>;

const ago = (t: KeyTestResult | null) =>
  t ? `${t.ok ? 'Worked' : 'Failed'} ${new Date(t.at).toLocaleString()}` : undefined;

function useTest(run: string, api: Api) {
  return () => api.send('POST', run).then(api.set);
}

// ── Email ──

function useEmail(status: EmailStatus, api: Api) {
  const create = useMutation({ mutationFn: () => api.send('POST', '/email'), onSuccess: api.set });
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', '/email'),
    onSuccess: () => void api.reload(),
  });
  return {
    create,
    remove,
    toggle: {
      checked: status.connected,
      disabled: (!status.available && !status.connected) || create.isPending || remove.isPending,
      label: 'Email on',
      onCheckedChange: (on: boolean) => (on ? create.mutate() : remove.mutate()),
    },
  };
}

function EmailBody({ status, api, errors }: { status: EmailStatus; api: Api; errors: unknown[] }) {
  if (!status.connected)
    return (
      <>
        <SettingField label="Sends to">
          <span className="truncate text-sm text-muted-foreground">
            {status.available ? 'Your sign-in address, once on' : 'Not set up on this server'}
          </span>
        </SettingField>
        {errors.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two fixed error slots
          <ErrorLine key={i} error={e} />
        ))}
      </>
    );
  return (
    <>
      <SettingField label="Sends to" info={`From ${api.sender}.`}>
        <SettingValue label="Address" value={status.address} />
      </SettingField>
      {errors.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two fixed error slots
        <ErrorLine key={i} error={e} />
      ))}
    </>
  );
}

// ── ntfy ──

/**
 * The person's ntfy.sh access token: ntfy.sh limits anonymous and free sends per
 * address, and the product sends from Cloudflare's shared ones, so sends go out under their paid account.
 */
function NtfyToken({ token, api }: { token: string | null; api: Api }) {
  const [editing, setEditing] = useState(!token);
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => api.send('PUT', '/ntfy/token', { token: value.trim() }),
    onSuccess: (data) => {
      api.set(data);
      setValue('');
      setEditing(false);
    },
  });
  return (
    <SettingField
      label="Token"
      htmlFor="ntfy-token"
      info={
        <>
          Needs a paid ntfy.sh account (Supporter or above): ntfy.sh limits free accounts by sending
          address, and {api.product} sends from Cloudflare's shared addresses. Create one at{' '}
          <a className="underline" href="https://ntfy.sh/account" target="_blank" rel="noreferrer">
            ntfy.sh
          </a>{' '}
          under Account ▸ Access tokens.
        </>
      }
    >
      {token && !editing ? (
        <SettingValue label="Access token" value={token} mono onReplace={() => setEditing(true)} />
      ) : (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save.mutate();
          }}
        >
          <InputGroup className="h-8">
            <InputGroupInput
              id="ntfy-token"
              type="password"
              className="num"
              autoComplete="off"
              placeholder="tk_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              {token ? (
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  aria-label="Cancel"
                  title="Cancel"
                  onClick={() => {
                    setValue('');
                    setEditing(false);
                  }}
                >
                  <XIcon />
                </InputGroupButton>
              ) : null}
              <InputGroupButton
                type="submit"
                size="icon-xs"
                aria-label="Save token"
                title="Save token"
                disabled={!value.trim() || save.isPending}
              >
                {save.isPending ? <RefreshCwIcon className="animate-spin" /> : <CheckIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <ErrorLine error={save.error} />
        </form>
      )}
    </SettingField>
  );
}

function useNtfy(status: NtfyStatus, api: Api) {
  const [confirm, setConfirm] = useState(false);
  const create = useMutation({ mutationFn: () => api.send('POST', '/ntfy'), onSuccess: api.set });
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', '/ntfy'),
    onSuccess: () => void api.reload(),
  });
  return {
    create,
    remove,
    confirm: (
      <LumenConfirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Turn off ntfy?"
        description={`${api.product} stops sending and forgets your topic. Turning on again makes a new topic, which your phone must subscribe to again.`}
        action="Turn off"
        onConfirm={() => remove.mutateAsync()}
      />
    ),
    toggle: {
      checked: status.connected,
      disabled: create.isPending || remove.isPending,
      label: 'ntfy on',
      onCheckedChange: (on: boolean) => (on ? create.mutate() : setConfirm(true)),
    },
  };
}

function NtfyBody({ status, api, errors }: { status: NtfyStatus; api: Api; errors: unknown[] }) {
  if (!status.connected)
    return (
      <>
        <SettingField
          label="Topic"
          info={`${api.product} makes you a private topic (a random name only you know) and sends to it with the access token of your own paid ntfy.sh account.`}
        >
          <span className="truncate text-sm text-muted-foreground">Made when you turn it on</span>
        </SettingField>
        {errors.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two fixed error slots
          <ErrorLine key={i} error={e} />
        ))}
      </>
    );
  return (
    <>
      <SettingField
        label="Topic"
        stack
        info={
          <>
            Install ntfy (
            <a className="underline" href={NTFY_IOS} target="_blank" rel="noreferrer">
              iPhone
            </a>{' '}
            or{' '}
            <a className="underline" href={NTFY_ANDROID} target="_blank" rel="noreferrer">
              Android
            </a>
            ), tap + and paste this topic, keeping the server as ntfy.sh. Keep it private: anyone
            with it can read it.
          </>
        }
      >
        <SettingValue label="Topic" value={status.topic} mono copy />
      </SettingField>
      <NtfyToken token={status.token} api={api} />
      {errors.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two fixed error slots
        <ErrorLine key={i} error={e} />
      ))}
    </>
  );
}

// ── Webhooks ──

function WebhookRow({ hook, api }: { hook: WebhookTarget; api: Api }) {
  const [busy, setBusy] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', `/webhooks/${encodeURIComponent(hook.id)}`),
    onSuccess: () => void api.reload(),
  });
  const test = useTest(`/webhooks/${encodeURIComponent(hook.id)}/test`, api);
  const headers = hook.headers.map((h) => `${h.name}: ${h.value}`).join(' · ');
  return (
    <SettingField
      label={hook.name}
      info={headers ? `Headers: ${headers}` : undefined}
      end={
        <span className="flex items-center gap-1">
          <SettingStatus
            health={settingHealth(true, hook.last_test)}
            title={hook.last_test?.error ?? ago(hook.last_test)}
          />
          <IconButton
            icon={RefreshCwIcon}
            size="icon-xs"
            label={`Test ${hook.name}`}
            busy={busy}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void test().finally(() => setBusy(false));
            }}
          />
          <LumenConfirm
            title={`Remove ${hook.name}?`}
            description={`${api.product} stops sending events to this address.`}
            action="Remove"
            onConfirm={() => remove.mutateAsync()}
          >
            <IconButton
              icon={Trash2Icon}
              size="icon-xs"
              label={`Remove ${hook.name}`}
              className="text-loss"
            />
          </LumenConfirm>
        </span>
      }
    >
      <SettingValue label="Address" value={hook.url} mono />
    </SettingField>
  );
}

function AddWebhook({ api }: { api: Api }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const setHeader = (i: number, part: 'name' | 'value', v: string) =>
    setHeaders((hs) => hs.map((h, j) => (j === i ? { ...h, [part]: v } : h)));
  const filled = headers.filter((h) => h.name.trim() || h.value.trim());
  const reset = () => {
    setName('');
    setUrl('');
    setHeaders([]);
    setOpen(false);
  };
  const add = useMutation({
    mutationFn: () =>
      api.send('POST', '/webhooks', {
        name: name.trim(),
        url: url.trim(),
        headers: filled.map((h) => ({ name: h.name.trim(), value: h.value.trim() })),
      }),
    onSuccess: (data) => {
      api.set(data);
      reset();
    },
  });
  if (!open)
    return (
      <button
        type="button"
        className="flex min-h-10 items-center gap-2 text-sm font-medium"
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" />
        Add webhook
      </button>
    );
  return (
    <form
      className="grid grid-cols-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && url.trim()) add.mutate();
      }}
    >
      <SettingField label="Name" htmlFor="wh-name">
        <Input
          id="wh-name"
          className="h-8"
          placeholder="Discord"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </SettingField>
      <SettingField
        label="Address"
        htmlFor="wh-url"
        info={`${api.product} posts each event as JSON ({ event, title, message, click, at }) to this https address: Slack, Discord, Home Assistant, n8n or anything that takes a webhook. Messages name no account, holding or amount.`}
      >
        <Input
          id="wh-url"
          className="num h-8"
          autoComplete="off"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </SettingField>
      {headers.map((h, i) => (
        <SettingField
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved
          key={i}
          label={`Header ${i + 1}`}
          htmlFor={`wh-header-${i}`}
          info={
            i === 0
              ? 'Sent with each post and hidden once saved. For a Cloudflare Access service token, add CF-Access-Client-Id and CF-Access-Client-Secret.'
              : undefined
          }
          end={
            <IconButton
              type="button"
              icon={XIcon}
              size="icon-xs"
              label="Remove header"
              onClick={() => setHeaders((hs) => hs.filter((_, j) => j !== i))}
            />
          }
        >
          <Input
            id={`wh-header-${i}`}
            className="num h-8 w-2/5"
            autoComplete="off"
            placeholder="Authorization"
            aria-label="Header name"
            value={h.name}
            onChange={(e) => setHeader(i, 'name', e.target.value)}
          />
          <Input
            className="num h-8 min-w-0 flex-1"
            type="password"
            autoComplete="off"
            placeholder="Value"
            aria-label="Header value"
            value={h.value}
            onChange={(e) => setHeader(i, 'value', e.target.value)}
          />
        </SettingField>
      ))}
      <div className="mt-1 flex min-h-10 items-center gap-2 border-t pt-2">
        <span className="min-w-0 flex-1">
          <ErrorLine error={add.error} />
        </span>
        {headers.length < 5 ? (
          <IconButton
            type="button"
            icon={PlusIcon}
            label="Add header"
            variant="outline"
            onClick={() => setHeaders((hs) => [...hs, { name: '', value: '' }])}
          />
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={reset}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim() || !url.trim() || add.isPending}>
          {add.isPending ? <RefreshCwIcon className="animate-spin" /> : <CheckIcon />}
          Add
        </Button>
      </div>
    </form>
  );
}

function Webhooks({ hooks, api }: { hooks: WebhookTarget[]; api: Api }) {
  return (
    <>
      {hooks.map((h) => (
        <WebhookRow key={h.id} hook={h} api={api} />
      ))}
      <AddWebhook api={api} />
    </>
  );
}

// ── Events: one row per event, one column per target ──

function EventCell({
  event,
  target,
  name,
  api,
}: {
  event: NotifyEvent;
  target: string;
  name: string;
  api: Api;
}) {
  const set = useMutation({
    mutationFn: (on: boolean) =>
      api.send('PUT', `/events/${encodeURIComponent(event.key)}`, { target, on }),
    onSuccess: api.set,
  });
  const on = set.isPending ? Boolean(set.variables) : !event.off.includes(target);
  return (
    <span className="flex items-center justify-center">
      <Checkbox
        aria-label={`${event.label} by ${name}`}
        checked={on}
        onCheckedChange={(v) => set.mutate(v === true)}
      />
    </span>
  );
}

function Events({ status, api }: { status: NotificationsStatus; api: Api }) {
  const targets = [
    ...(status.email.connected ? [{ id: 'email', name: 'Email' }] : []),
    ...(status.ntfy.connected ? [{ id: 'ntfy', name: 'ntfy' }] : []),
    ...status.webhooks.map((h) => ({ id: h.id, name: h.name })),
  ];
  if (!targets.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to send to yet: turn on email or ntfy, or add a webhook, first.
      </p>
    );
  // The event column gives way first, so a phone shows the checkboxes; its detail waits in the hover.
  const grid = { gridTemplateColumns: `minmax(7rem, 1fr) repeat(${targets.length}, 5.5rem)` };
  // Groups in the order they first appear; events without one come first, unlabelled.
  const groups: { label?: string; events: NotifyEvent[] }[] = [];
  for (const e of status.events) {
    const g = groups.find((x) => x.label === e.group);
    if (g) g.events.push(e);
    else groups.push({ label: e.group, events: [e] });
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="overflow-x-auto">
        <div aria-label="Events" className="grid min-w-max items-center" style={grid}>
          <div className="contents">
            <span className="pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Event
            </span>
            {targets.map((t) => (
              <span
                key={t.id}
                className="truncate pb-1 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                title={t.name}
              >
                {t.name}
              </span>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.label ?? ''} className="contents">
              {g.label ? (
                <span
                  className="border-t pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  style={{ gridColumn: '1 / -1' }}
                >
                  {g.label}
                </span>
              ) : null}
              {g.events.map((e) => (
                <div key={e.key} className="contents">
                  {/* One line: the label, then its detail cut with an ellipsis, all of it on hover. */}
                  <span
                    className="flex min-w-0 items-baseline gap-2 border-t py-2 pr-3"
                    title={`${e.label}: ${e.detail}`}
                  >
                    <span className="truncate text-sm whitespace-nowrap sm:shrink-0">
                      {e.label}
                    </span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                      {e.detail}
                    </span>
                  </span>
                  {targets.map((t) => (
                    <span key={t.id} className="self-stretch border-t py-2">
                      <span className="flex h-full items-center justify-center">
                        <EventCell event={e} target={t.id} name={t.name} api={api} />
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">A new target starts with every event on.</p>
    </div>
  );
}

function Channels({
  s,
  api,
  open,
  toggle,
}: {
  s: NotificationsStatus;
  api: Api;
  open: string | null;
  toggle: (id: string) => (o: boolean) => void;
}) {
  const email = useEmail(s.email, api);
  const ntfy = useNtfy(s.ntfy, api);
  const testEmail = useTest('/email/test', api);
  const testNtfy = useTest('/ntfy/test', api);
  const emailTest = s.email.connected ? s.email.last_test : null;
  const ntfyTest = s.ntfy.connected ? s.ntfy.last_test : null;
  const hooksFailed = s.webhooks.filter((h) => h.last_test?.ok === false);
  return (
    <div className="grid grid-cols-1">
      {ntfy.confirm}
      <LumenExpandRow
        icon={<MailIcon className="size-4 shrink-0 text-muted-foreground" />}
        name="Email"
        meta={s.email.connected ? s.email.address : 'To your sign-in address'}
        open={open === 'email'}
        onOpenChange={toggle('email')}
        status={
          <SettingStatus
            health={settingHealth(s.email.connected, emailTest)}
            title={emailTest?.error ?? ago(emailTest)}
          />
        }
        toggle={email.toggle}
        actions={
          s.email.connected ? <SettingActions test={emailTest} onTest={testEmail} /> : undefined
        }
      >
        <EmailBody status={s.email} api={api} errors={[email.create.error, email.remove.error]} />
      </LumenExpandRow>
      <LumenExpandRow
        icon={<BellIcon className="size-4 shrink-0 text-muted-foreground" />}
        name="ntfy"
        meta="Phone push through the ntfy app"
        open={open === 'ntfy'}
        onOpenChange={toggle('ntfy')}
        status={
          <SettingStatus
            health={settingHealth(s.ntfy.connected, ntfyTest)}
            title={ntfyTest?.error ?? ago(ntfyTest)}
          />
        }
        toggle={ntfy.toggle}
        actions={
          s.ntfy.connected ? <SettingActions test={ntfyTest} onTest={testNtfy} /> : undefined
        }
      >
        <NtfyBody status={s.ntfy} api={api} errors={[ntfy.create.error, ntfy.remove.error]} />
      </LumenExpandRow>
      <LumenExpandRow
        icon={<WebhookIcon className="size-4 shrink-0 text-muted-foreground" />}
        name="Webhooks"
        meta={
          s.webhooks.length
            ? s.webhooks.map((h) => h.name).join(' · ')
            : 'Events posted to your own addresses'
        }
        open={open === 'webhooks'}
        onOpenChange={toggle('webhooks')}
        status={
          hooksFailed.length ? (
            <SettingStatus health="failed" title={hooksFailed.map((h) => h.name).join(', ')} />
          ) : s.webhooks.length ? (
            <SettingStatus
              count={`${s.webhooks.length} webhook${s.webhooks.length === 1 ? '' : 's'}`}
            />
          ) : (
            <SettingStatus health="off" />
          )
        }
      >
        <Webhooks hooks={s.webhooks} api={api} />
      </LumenExpandRow>
    </div>
  );
}

/** The Settings ▸ Notifications section's body. */
export function NotificationsSettings({
  api: base,
  product,
  sender,
  parts = 'all',
}: {
  /** The app's Notifications API base, e.g. `/api/notifications`. */
  api: string;
  /** The product's name in the copy ("Get Acme alerts by email"). */
  product: string;
  /** The address email comes from. */
  sender: string;
  /**
   * What to draw: the channels and the events grid (default), only the channels (where messages
   * go) or only the events grid (what goes where), so an app can set them in two sections.
   */
  parts?: 'all' | 'channels' | 'events';
}) {
  const api = useNotifications(base, product, sender);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => (o: boolean) => setOpen(o ? id : null);
  if (api.q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (api.q.isError) return <ErrorLine error={api.q.error} />;
  const s = api.q.data;
  if (parts === 'events') return <Events status={s} api={api} />;
  return (
    <div className="grid grid-cols-1 gap-6">
      <Channels s={s} api={api} open={open} toggle={toggle} />
      {parts === 'all' ? (
        <section className="grid grid-cols-1 gap-2">
          <h4 className="font-medium">Events</h4>
          <Events status={s} api={api} />
        </section>
      ) : null}
    </div>
  );
}
