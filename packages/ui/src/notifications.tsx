import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  CopyIcon,
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
import { fetchWithin } from './fetch-within';
import {
  ErrorLine,
  IntegrationRow,
  KeyTestLine,
  type KeyTestResult,
  TestBadge,
} from './integrations';
import { IconButton } from './page';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { Label } from './ui/label';

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

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-2">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function CopyField({ id, value }: { id: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        readOnly
        className="num"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="xs"
          aria-label="Copy topic"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** A test that answers refreshes the section. */
function TestLine({ test, run, api }: { test: KeyTestResult | null; run: string; api: Api }) {
  return <KeyTestLine test={test} run={() => api.send('POST', run).then(api.set)} />;
}

// ── Email ──

function Email({ status, api }: { status: EmailStatus; api: Api }) {
  const create = useMutation({ mutationFn: () => api.send('POST', '/email'), onSuccess: api.set });
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', '/email'),
    onSuccess: () => void api.reload(),
  });
  if (!status.connected)
    return status.available ? (
      <div className="grid grid-cols-1 gap-3">
        <p className="text-sm">
          Get {api.product} alerts by email at the address you sign in with. Nothing to set up.
        </p>
        <ErrorLine error={create.error} />
        <IconButton
          icon={create.isPending ? RefreshCwIcon : MailIcon}
          label="Turn on email"
          variant="outline"
          className="justify-self-start"
          disabled={create.isPending}
          busy={create.isPending}
          onClick={() => create.mutate()}
        />
      </div>
    ) : (
      <p className="text-sm">Email is not set up on this server.</p>
    );
  return (
    <div className="grid grid-cols-1 gap-5">
      <Section title="Sends to">
        <p className="text-sm">
          {status.address}, from {api.sender}
        </p>
      </Section>
      <Section title="Test">
        <TestLine test={status.last_test} run="/email/test" api={api} />
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <ErrorLine error={remove.error} />
        <span className="flex-1" />
        <LumenConfirm
          title="Turn off email notifications?"
          description={`${api.product} stops emailing you. You can turn it on again any time.`}
          action="Turn off"
          onConfirm={() => remove.mutate()}
        >
          <IconButton icon={Trash2Icon} label="Turn off" variant="destructive" />
        </LumenConfirm>
      </div>
    </div>
  );
}

// ── ntfy ──

/**
 * The person's ntfy.sh access token: ntfy.sh limits anonymous and free sends per
 * address, and the product sends from Cloudflare's shared ones, so sends go out under their paid account.
 */
function NtfyToken({ token, api }: { token: string | null; api: Api }) {
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => api.send('PUT', '/ntfy/token', { token: value.trim() }),
    onSuccess: (data) => {
      api.set(data);
      setValue('');
    },
  });
  return (
    <Section title="Access token">
      <p className="text-sm">
        This needs a paid account at{' '}
        <a className="underline" href="https://ntfy.sh/account" target="_blank" rel="noreferrer">
          ntfy.sh
        </a>{' '}
        (Supporter or above): ntfy.sh limits free accounts by sending address, and {api.product}{' '}
        sends from Cloudflare's shared addresses. Open Account ▸ Access tokens, create one and paste
        it here.
      </p>
      {token ? (
        <p className="text-sm">
          Saved <span className="num">{token}</span>
        </p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field id="ntfy-token" label={token ? 'Replace token' : 'Access token'}>
            <Input
              id="ntfy-token"
              type="password"
              className="num"
              autoComplete="off"
              placeholder="tk_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" size="sm" disabled={!value.trim() || save.isPending}>
          {save.isPending ? <RefreshCwIcon className="animate-spin" /> : <CheckIcon />}
          Save
        </Button>
      </form>
      <ErrorLine error={save.error} />
    </Section>
  );
}

function Ntfy({ status, api }: { status: NtfyStatus; api: Api }) {
  const create = useMutation({ mutationFn: () => api.send('POST', '/ntfy'), onSuccess: api.set });
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', '/ntfy'),
    onSuccess: () => void api.reload(),
  });
  if (!status.connected)
    return (
      <div className="grid grid-cols-1 gap-3">
        <p className="text-sm">
          Get {api.product} alerts on your phone through the free ntfy app. {api.product} makes you
          a private topic (a random name only you know) and sends to it with the access token of
          your own paid ntfy.sh account.
        </p>
        <ErrorLine error={create.error} />
        <IconButton
          icon={create.isPending ? RefreshCwIcon : BellIcon}
          label="Turn on ntfy"
          variant="outline"
          className="justify-self-start"
          disabled={create.isPending}
          busy={create.isPending}
          onClick={() => create.mutate()}
        />
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-5">
      <Section title="Set up your phone">
        <ol className="grid list-decimal grid-cols-1 gap-2 pl-5 text-sm">
          <li>
            Install ntfy:{' '}
            <a className="underline" href={NTFY_IOS} target="_blank" rel="noreferrer">
              iPhone
            </a>{' '}
            or{' '}
            <a className="underline" href={NTFY_ANDROID} target="_blank" rel="noreferrer">
              Android
            </a>
            .
          </li>
          <li>
            Open it, tap + (Subscribe to topic) and paste your topic. Keep the server as ntfy.sh.
          </li>
          <li>
            Allow notifications when your phone asks, add your access token below, then tap Test.
          </li>
        </ol>
        <Field id="ntfy-topic" label="Your topic (keep it private: anyone with it can read it)">
          <CopyField id="ntfy-topic" value={status.topic} />
        </Field>
      </Section>
      <NtfyToken token={status.token} api={api} />
      <Section title="Test">
        <TestLine test={status.last_test} run="/ntfy/test" api={api} />
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <ErrorLine error={remove.error} />
        <span className="flex-1" />
        <LumenConfirm
          title="Turn off ntfy?"
          description={`${api.product} stops sending and forgets your topic. Turning on again makes a new topic, which your phone must subscribe to again.`}
          action="Turn off"
          onConfirm={() => remove.mutate()}
        >
          <IconButton icon={Trash2Icon} label="Turn off" variant="destructive" />
        </LumenConfirm>
      </div>
    </div>
  );
}

// ── Webhooks ──

function WebhookRow({ hook, api }: { hook: WebhookTarget; api: Api }) {
  const remove = useMutation({
    mutationFn: () => api.send('DELETE', `/webhooks/${encodeURIComponent(hook.id)}`),
    onSuccess: () => void api.reload(),
  });
  return (
    <div className="grid grid-cols-1 gap-2 border-b pb-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <WebhookIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{hook.name}</span>
        <span className="num min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {hook.url}
        </span>
        <LumenConfirm
          title={`Remove ${hook.name}?`}
          description={`${api.product} stops sending events to this address.`}
          action="Remove"
          onConfirm={() => remove.mutate()}
        >
          <IconButton icon={Trash2Icon} label={`Remove ${hook.name}`} variant="destructive" />
        </LumenConfirm>
      </div>
      {hook.headers.length ? (
        <p className="num text-xs text-muted-foreground">
          {hook.headers.map((h) => `${h.name}: ${h.value}`).join(' · ')}
        </p>
      ) : null}
      <TestLine
        test={hook.last_test}
        run={`/webhooks/${encodeURIComponent(hook.id)}/test`}
        api={api}
      />
      <ErrorLine error={remove.error} />
    </div>
  );
}

function Webhooks({ hooks, api }: { hooks: WebhookTarget[]; api: Api }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const setHeader = (i: number, part: 'name' | 'value', v: string) =>
    setHeaders((hs) => hs.map((h, j) => (j === i ? { ...h, [part]: v } : h)));
  const filled = headers.filter((h) => h.name.trim() || h.value.trim());
  const add = useMutation({
    mutationFn: () =>
      api.send('POST', '/webhooks', {
        name: name.trim(),
        url: url.trim(),
        headers: filled.map((h) => ({ name: h.name.trim(), value: h.value.trim() })),
      }),
    onSuccess: (data) => {
      api.set(data);
      setName('');
      setUrl('');
      setHeaders([]);
    },
  });
  return (
    <div className="grid grid-cols-1 gap-5">
      <p className="text-sm">
        {api.product} posts each event as JSON to your own addresses: Slack, Discord, Home
        Assistant, n8n or anything that takes a webhook.
      </p>
      {hooks.length ? (
        <Section title="Your webhooks">
          {hooks.map((h) => (
            <WebhookRow key={h.id} hook={h} api={api} />
          ))}
        </Section>
      ) : null}
      <Section title="Add a webhook">
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && url.trim()) add.mutate();
          }}
        >
          <Field id="wh-name" label="Name">
            <Input
              id="wh-name"
              placeholder="Discord"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="wh-url" label="Address (https)">
            <Input
              id="wh-url"
              className="num"
              autoComplete="off"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          {headers.length ? (
            <Field id="wh-header-0" label="Headers (sent with each post; hidden once saved)">
              <div className="grid grid-cols-1 gap-2">
                {headers.map((h, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      id={`wh-header-${i}`}
                      className="num w-2/5"
                      autoComplete="off"
                      placeholder="Authorization"
                      aria-label="Header name"
                      value={h.name}
                      onChange={(e) => setHeader(i, 'name', e.target.value)}
                    />
                    <Input
                      className="num min-w-0 flex-1"
                      type="password"
                      autoComplete="off"
                      placeholder="Value"
                      aria-label="Header value"
                      value={h.value}
                      onChange={(e) => setHeader(i, 'value', e.target.value)}
                    />
                    <IconButton
                      type="button"
                      icon={XIcon}
                      label="Remove header"
                      onClick={() => setHeaders((hs) => hs.filter((_, j) => j !== i))}
                    />
                  </div>
                ))}
              </div>
            </Field>
          ) : null}
          <ErrorLine error={add.error} />
          <div className="flex flex-wrap items-center gap-2">
            {headers.length < 5 ? (
              <IconButton
                type="button"
                icon={PlusIcon}
                label="Add header"
                variant="outline"
                onClick={() => setHeaders((hs) => [...hs, { name: '', value: '' }])}
              />
            ) : null}
            <span className="flex-1" />
            <Button type="submit" size="sm" disabled={!name.trim() || !url.trim() || add.isPending}>
              {add.isPending ? <RefreshCwIcon className="animate-spin" /> : <PlusIcon />}
              Add
            </Button>
          </div>
        </form>
      </Section>
      <p className="text-xs text-muted-foreground">
        Each post is <span className="num">{'{ event, title, message, click, at }'}</span>. Messages
        name no account, holding or amount. For a Cloudflare Access service token, add the headers
        CF-Access-Client-Id and CF-Access-Client-Secret.
      </p>
    </div>
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
        Nothing to send to yet: turn on email or ntfy, or add a webhook, above.
      </p>
    );
  const grid = { gridTemplateColumns: `minmax(12rem, 2.4fr) repeat(${targets.length}, 5.5rem)` };
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
          {status.events.map((e) => (
            <div key={e.key} className="contents">
              <span className="grid gap-0.5 border-t py-2 pr-3">
                <span className="text-sm">{e.label}</span>
                <span className="text-xs text-muted-foreground">{e.detail}</span>
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
      </div>
      <p className="text-xs text-muted-foreground">A new target starts with every event on.</p>
    </div>
  );
}

/** The Settings ▸ Notifications section's body. */
export function NotificationsSettings({
  api: base,
  product,
  sender,
}: {
  /** The app's Notifications API base, e.g. `/api/notifications`. */
  api: string;
  /** The product's name in the copy ("Get Acme alerts by email"). */
  product: string;
  /** The address email comes from. */
  sender: string;
}) {
  const api = useNotifications(base, product, sender);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => (o: boolean) => setOpen(o ? id : null);
  if (api.q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (api.q.isError) return <ErrorLine error={api.q.error} />;
  const s = api.q.data;
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1">
        <IntegrationRow
          name="Email"
          meta="To your sign-in address"
          open={open === 'email'}
          onOpenChange={toggle('email')}
          badge={
            s.email.connected ? (
              <TestBadge test={s.email.last_test} />
            ) : (
              <Badge variant="outline">Off</Badge>
            )
          }
        >
          <Email status={s.email} api={api} />
        </IntegrationRow>
        <IntegrationRow
          name="ntfy"
          meta="Phone notifications through the ntfy app"
          open={open === 'ntfy'}
          onOpenChange={toggle('ntfy')}
          badge={
            s.ntfy.connected ? (
              <TestBadge test={s.ntfy.last_test} />
            ) : (
              <Badge variant="outline">Off</Badge>
            )
          }
        >
          <Ntfy status={s.ntfy} api={api} />
        </IntegrationRow>
        <IntegrationRow
          name="Webhooks"
          meta={
            s.webhooks.length
              ? s.webhooks.map((h) => h.name).join(' · ')
              : 'Events posted to your own addresses'
          }
          open={open === 'webhooks'}
          onOpenChange={toggle('webhooks')}
          badge={
            s.webhooks.length ? (
              s.webhooks.some((h) => h.last_test?.ok === false) ? (
                <Badge variant="outline" className="text-loss">
                  <AlertTriangleIcon />
                  Failed
                </Badge>
              ) : (
                <Badge variant="outline">
                  {s.webhooks.length} webhook{s.webhooks.length === 1 ? '' : 's'}
                </Badge>
              )
            ) : (
              <Badge variant="outline">None</Badge>
            )
          }
        >
          <Webhooks hooks={s.webhooks} api={api} />
        </IntegrationRow>
      </div>
      <section className="grid grid-cols-1 gap-2">
        <h4 className="font-medium">Events</h4>
        <Events status={s} api={api} />
      </section>
    </div>
  );
}
