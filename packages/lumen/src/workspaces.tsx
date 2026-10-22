import {
  type FrameData,
  type FrameMeta,
  frameConfig,
  frameKeyAt,
  frameSymbolAt,
  liveQuoteColumns,
} from '@columenlabs/lumen-types/frames';
import {
  type CustomViewConfig,
  customViewConfigSchema,
  frameSpace,
} from '@columenlabs/lumen-types/views';
import {
  type Workspace,
  type WorkspaceTab,
  workspacePath,
} from '@columenlabs/lumen-types/workspaces';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  ArrowRightLeftIcon,
  CalendarIcon,
  ExternalLinkIcon,
  HashIcon,
  LayersIcon,
  PencilIcon,
  SparklesIcon,
  TableIcon,
  TextCursorInputIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiJson } from './api-fetch';
import { useAssistant, useAssistantName, useAssistantPending } from './assistant-context';
import { useAssistantWorkspace } from './assistant-screen';
import { LumenConfirm } from './confirm';
import { FrameScriptDialog } from './frame-script';
import { editedCells, editedKey, frameColor, useFrameEdits } from './joins';
import { LumenLayout } from './lumen-layout';
import { LumenPageState } from './lumen-page-state';
import { LumenSelector } from './lumen-selector';
import { useLumenLoad } from './lumen-source';
import { LumenTabDrawer } from './lumen-tab-drawer';
import { LumenTabs } from './lumen-tabs';
import { lumenToast } from './lumen-toast';
import type { ViewDomain, ViewField } from './lumen-view';
import { useHasMarket } from './market/live';
import { SidebarSection } from './nav';
// LumenWorkspaces (in Lumen): the assistant produces data, the shell renders
// it. A workspace is a page of tabs, one list per person, each belonging to one app of the product;
// each tab is a LumenLayout over a frame the assistant made (rows plus the script that made them) or
// a card over one of the app's own data domains, which the app draws live (an app's holdings,
// lots, ...). The person filters, groups, pivots and edits a tab like any view, the assistant patches
// it, and its layout is kept as they leave it; when the assistant remakes a frame of the same name,
// the tab's rows change and its layout stays (new columns join it after its own). A frame is a data
// domain like any other: one with a symbol column carries the symbol key, so the registry's Symbol
// join attaches to it through the shell's joins. Workspaces live under the assistant's API; the
// product says its apps and domains with `WorkspacesProvider`.
import { type Crumb, IconButton } from './page';
import { StatusItem, useShell } from './shell';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { iconOf } from './view-icons';
import { WORKSPACES_KEY, frameKey, workspacesListQuery } from './workspace-keys';

type WorkspaceRead = Workspace & { frames: Record<string, FrameMeta> };
type Icon = ComponentType<{ className?: string }>;

/** An app a workspace can belong to (the product's apps). */
export interface WorkspaceApp {
  id: string;
  label: string;
  /** Its address; a workspace there is at `${href}workspaces/<id>`. */
  href: string;
  icon?: Icon;
}

/** What the product tells its workspaces; every field may be left out by a one-app product. */
export interface WorkspacesConfig {
  /** The apps a workspace may move to that this person can open, this one included. */
  apps?: WorkspaceApp[];
  /** What the product calls an app: e.g. `desk`. */
  appNoun?: string;
  /** Which app draws a tab over a domain; one it does not say is this app's. */
  domainApp?: (domain: string) => string | undefined;
  /** A domain tab's starting layout. */
  defaultConfig?: (domain: string) => CustomViewConfig | null;
  /** The empty workspace's example ask, on an app: `put my holdings with their earnings dates in`. */
  example?: (app: string) => string;
}
const ConfigCtx = createContext<WorkspacesConfig>({});
/** The product's apps and domains for its workspaces. */
export const WorkspacesProvider = ConfigCtx.Provider;

const json = <T,>(url: string, init?: RequestInit) => apiJson<T>(url, init, 'workspaces');

const workspaceQuery = (api: string, id: string) => ({
  queryKey: [...WORKSPACES_KEY, api, 'ws', id],
  queryFn: () => json<WorkspaceRead>(`${api}/workspaces/${id}`),
});

/** The api the assistant answers on, where the app has one. */
function useApi() {
  return useAssistant()?.api ?? null;
}

/**
 * Workspaces in the sidebar: one item per workspace, newest first; `+` starts an empty one, the
 * trash icon deletes one (its frames stay until no tab shows them). Hidden where the app has no
 * assistant.
 */
export function WorkspacesSection() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ ...workspacesListQuery(api ?? ''), enabled: !!api });
  const assistant = useAssistantName();
  const create = useMutation({
    mutationFn: () =>
      json<Workspace>(`${api}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ name: 'New workspace' }),
      }),
    onSuccess: (w) => {
      void qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      void navigate({ href: workspacePath(w.id) });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => json(`${api}/workspaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
  if (!api || list.isError) return null;
  return (
    <SidebarSection
      label="Workspaces"
      loading={list.isPending}
      onAdd={() => create.mutate()}
      addLabel="New workspace"
      onRemove={(item) => remove.mutate(item.id)}
      removeLabel={(item) => `Delete workspace ${item.title}`}
      empty={`Ask ${assistant} for data: it opens here`}
      items={(list.data?.workspaces ?? []).map((w) => ({
        id: w.id,
        title: w.name,
        to: workspacePath(w.id),
        icon: LayersIcon,
        badge: w.tabs.length || undefined,
      }))}
    />
  );
}

/** What an app draws for a tab over one of its own domains, inside the workspace page. */
export interface WorkspaceDraftProps {
  domain: string;
  /** The tab's layout: the person's and the assistant's edits, else the domain's default view. */
  config: CustomViewConfig;
  onChange: (config: CustomViewConfig) => void;
  crumbs: Crumb[];
  /** The tab row, drawn above the cards. */
  intro: ReactNode;
  actions: ReactNode;
  tabKey: string;
  /** A workspace tab is a sheet (rule C): chips, sort and grouping save at once. */
  save: 'sheet';
}

/**
 * `/workspaces/$id` on every app with an assistant. `draft` draws a tab over one of the app's own
 * domains (an app passes its portfolio view); a tab over another app's domain links there.
 */
export function WorkspacePage({ draft }: { draft?: (p: WorkspaceDraftProps) => ReactNode }) {
  const api = useApi();
  const { id = '' } = useParams({ strict: false }) as { id?: string };
  const search = useSearch({ strict: false }) as { tab?: string };
  const q = useQuery({ ...workspaceQuery(api ?? '', id), enabled: !!api && !!id });
  const pending = useAssistantPending();
  const assistant = useAssistantName();
  const w = q.data;
  if (!api || !w)
    return (
      <LumenPageState
        crumbs={[{ label: 'Workspaces' }]}
        title="Workspace"
        icon={LayersIcon}
        tabs
        query={api ? q : undefined}
        waiting={pending}
        error={!api && !pending ? new Error(`Workspaces need ${assistant} here.`) : null}
        notFound="No workspace with this id. It may have been deleted."
      />
    );
  const tab = w.tabs.find((t) => t.id === search.tab) ?? w.tabs[0] ?? null;
  return <WorkspaceBody api={api} w={w} tab={tab} draft={draft} />;
}

function WorkspaceBody({
  api,
  w,
  tab,
  draft,
}: {
  api: string;
  w: WorkspaceRead;
  tab: WorkspaceTab | null;
  draft?: (p: WorkspaceDraftProps) => ReactNode;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // The assistant sees this workspace and its tabs by id, so it adds here and survives renames.
  useAssistantWorkspace({
    id: w.id,
    name: w.name.slice(0, 80),
    tabs: w.tabs.slice(0, 20).map((t) => ({
      id: t.id,
      name: t.name.slice(0, 80),
      source: ('frame' in t.source
        ? `frame ${w.frames[t.source.frame]?.name ?? t.source.frame}`
        : t.source.domain
      ).slice(0, 120),
    })),
    open: tab?.id ?? null,
  });
  const [naming, setNaming] = useState<'workspace' | null>(null);
  const [editingTab, setEditingTab] = useState(false);
  const [removing, setRemoving] = useState<'workspace' | null>(null);
  const key = workspaceQuery(api, w.id).queryKey;
  const put = (next: WorkspaceRead) => qc.setQueryData(key, next);
  const rename = useMutation({
    mutationFn: async (name: string) =>
      json<Workspace>(`${api}/workspaces/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (next) => {
      put({ ...w, ...next });
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'list'] });
    },
  });
  // The Tab drawer's Save: its name, and its icon kept in the tab's config.
  const editTab = useMutation({
    mutationFn: async (next: { name: string; config?: CustomViewConfig }) =>
      json<Workspace>(`${api}/workspaces/${w.id}/tabs/${tab?.id}`, {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: (next) => {
      put({ ...w, ...next });
      setEditingTab(false);
    },
  });
  // Move to app: the workspace leaves this app's sidebar for another's.
  const here = useShell().app;
  const config = useContext(ConfigCtx);
  const assistant = useAssistantName();
  const noun = config.appNoun ?? 'app';
  const appOf = (id: string) => config.apps?.find((a) => a.id === id);
  const moveTo = (config.apps ?? []).filter((a) => a.id !== here);
  const move = useMutation({
    mutationFn: (app: string) =>
      json<Workspace>(`${api}/workspaces/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ app }),
      }),
    onSuccess: (next) => {
      const to = appOf(next.app) ?? { label: next.app, href: '/' };
      void qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      lumenToast(`Moved ${w.name} to ${to.label}`, {
        action: {
          label: 'Open',
          onClick: () =>
            window.open(`${to.href.replace(/\/$/, '')}${workspacePath(w.id)}`, '_blank'),
        },
      });
      void navigate({ href: '/' });
    },
  });
  const remove = useMutation({
    mutationFn: (what: 'workspace' | 'tab') =>
      json(
        what === 'workspace'
          ? `${api}/workspaces/${w.id}`
          : `${api}/workspaces/${w.id}/tabs/${tab?.id}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, what) => {
      void qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      if (what === 'workspace') void navigate({ href: '/' });
      else void navigate({ href: workspacePath(w.id), replace: true });
    },
  });
  // A layout edit saves at once; the page keeps what is on screen meanwhile.
  const saveConfig = useMutation({
    mutationFn: ({ tab: t, config }: { tab: string; config: CustomViewConfig }) =>
      json<Workspace>(`${api}/workspaces/${w.id}/tabs/${t}`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      }),
  });
  // A tab is a sheet (rule C): every change saves at once, with Undo in a
  // toast that puts the tab's config back as it was before the change.
  const onChange = (config: CustomViewConfig) => {
    if (!tab) return;
    const before = tab.config;
    put({ ...w, tabs: w.tabs.map((t) => (t.id === tab.id ? { ...t, config } : t)) });
    saveConfig.mutate({ tab: tab.id, config });
    lumenToast.undo(
      'Saved to this tab',
      () => {
        put({ ...w, tabs: w.tabs.map((t) => (t.id === tab.id ? { ...t, config: before } : t)) });
        if (before) saveConfig.mutate({ tab: tab.id, config: before });
        else
          void json(`${api}/workspaces/${w.id}/tabs/${tab.id}`, {
            method: 'PUT',
            body: JSON.stringify({ config: null }),
          }).then(() => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }));
      },
      { id: `ws-save:${tab.id}`, duration: 4000 },
    );
  };

  const intro = (
    <LumenTabs
      tabs={w.tabs.map((t) => ({ value: t.id, label: t.name, icon: tabIcon(t) }))}
      value={tab?.id}
      onChange={(t) => void navigate({ href: workspacePath(w.id, t), replace: true })}
      actions={
        tab && <IconButton icon={PencilIcon} label="Edit tab" onClick={() => setEditingTab(true)} />
      }
    />
  );
  const crumbs: Crumb[] = [{ label: 'Workspaces' }, { label: w.name }];
  const actions = (
    <>
      <IconButton
        icon={TextCursorInputIcon}
        label="Rename workspace"
        onClick={() => setNaming('workspace')}
      />
      {moveTo.length > 0 && (
        <LumenSelector
          trigger="icon"
          icon={ArrowRightLeftIcon}
          label={`Move to ${noun}`}
          align="end"
          search={false}
          options={moveTo.map((a) => ({ value: a.id, label: a.label, icon: a.icon }))}
          value={null}
          onChange={(a) => move.mutate(a)}
        />
      )}
      <IconButton
        icon={Trash2Icon}
        label="Delete workspace"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setRemoving('workspace')}
      />
    </>
  );
  const dialogs = (
    <>
      <NameDialog
        open={naming !== null}
        title="Rename workspace"
        value={w.name}
        onClose={() => setNaming(null)}
        onSave={(name) => rename.mutate(name)}
      />
      {tab && (
        <LumenTabDrawer
          open={editingTab}
          onClose={() => setEditingTab(false)}
          name={tab.name}
          icon={tab.config?.icon}
          fallback={tabIcon({ ...tab, config: null })}
          description="Its filters and columns save as you change them."
          maxName={60}
          busy={editTab.isPending}
          error={editTab.error?.message}
          onSave={({ name, icon }) =>
            editTab.mutate(
              icon === (tab.config?.icon ?? null)
                ? { name }
                : { name, config: { ...tabConfig(tab, w, config.defaultConfig), name, icon } },
            )
          }
          remove={{
            description: 'Its layout goes with it.',
            onRemove: () => {
              setEditingTab(false);
              remove.mutate('tab');
            },
          }}
        />
      )}
      <LumenConfirm
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${w.name}?`}
        description={`Its tabs go with it. ${assistant} can make them again from its chats.`}
        onConfirm={() => remove.mutate('workspace')}
      />
    </>
  );

  let body: ReactNode;
  if (!tab) {
    body = (
      <LumenLayout
        crumbs={crumbs}
        actions={actions}
        intro={intro}
        cards={[
          {
            id: 'empty',
            title: 'No tabs yet',
            icon: LayersIcon,
            kind: 'widget',
            children: (
              <p className="text-sm text-muted-foreground">
                Ask {assistant} for data and to open it here: “
                {config.example?.(here) ?? 'put this month’s numbers in'} {w.name}”.
              </p>
            ),
          },
        ]}
      />
    );
  } else if ('frame' in tab.source) {
    const meta = w.frames[tab.source.frame];
    body = meta ? (
      <FrameTab
        key={tab.id}
        api={api}
        tab={tab}
        meta={meta}
        crumbs={crumbs}
        actions={actions}
        intro={intro}
        onChange={onChange}
      />
    ) : (
      <LumenLayout
        crumbs={crumbs}
        actions={actions}
        intro={intro}
        cards={[
          {
            id: 'gone',
            title: tab.name,
            icon: TableIcon,
            kind: 'widget',
            children: (
              <p className="text-sm text-muted-foreground">
                This tab’s frame is gone. Ask {assistant} to make it again.
              </p>
            ),
          },
        ]}
      />
    );
  } else if (draft && (config.domainApp?.(tab.source.domain) ?? here) === here) {
    body = draft({
      domain: tab.source.domain,
      config: tabConfig(tab, w, config.defaultConfig),
      onChange,
      crumbs,
      intro,
      actions,
      tabKey: tab.id,
      save: 'sheet',
    });
  } else {
    // A tab over another app's data opens on that app (an app's portfolio, an app's bank).
    const ownerId = config.domainApp?.(tab.source.domain) ?? here;
    const owner = appOf(ownerId) ?? { label: ownerId, href: '/' };
    const href = `${owner.href.replace(/\/$/, '')}${workspacePath(w.id, tab.id)}`;
    body = (
      <LumenLayout
        crumbs={crumbs}
        actions={actions}
        intro={intro}
        cards={[
          {
            id: 'elsewhere',
            title: tab.name,
            icon: TableIcon,
            kind: 'widget',
            children: (
              <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                <p>This tab shows your {owner.label} data, so it opens there.</p>
                <IconButton
                  icon={ExternalLinkIcon}
                  label={`Open in ${owner.label}`}
                  variant="outline"
                  href={href}
                />
              </div>
            ),
          },
        ]}
      />
    );
  }
  return (
    <>
      {body}
      {dialogs}
    </>
  );
}

/** One row of a frame: its cells in the order of the frame's columns. */
interface FrameRow {
  i: number;
  v: (string | number | null)[];
}

/** A frame as a data domain: one field per column; a symbol column is its symbol key. */
/** How a frame tab's cells edit in place: by the row's key, else its index. */
interface FrameEditing {
  edited: Set<string>;
  save: (edit: {
    key?: string;
    row?: number;
    column: string;
    value: string | null;
  }) => Promise<unknown>;
}

function frameDomain(
  meta: FrameMeta,
  symbolAt: number,
  editing?: FrameEditing,
  /** Columns left out: a frame's own copy of a live quote the app's Symbol join draws live. */
  drop: ReadonlySet<string> = new Set(),
  /** The assistant's name, on the frame's field group. */
  assistant = 'Assistant',
): ViewDomain<FrameRow> {
  const accountAt = frameKeyAt(meta, 'account');
  const keyAt = meta.kind === 'linked' && meta.key ? frameKeyAt(meta, meta.key) : -1;
  const rowKey = (r: FrameRow): string | number => (keyAt >= 0 ? String(r.v[keyAt] ?? '') : r.i);
  const fields: ViewField<FrameRow>[] = meta.columns.flatMap((c, i) =>
    drop.has(c.key)
      ? []
      : [
          {
            key: c.key,
            name: `${frameSpace(meta.name)}.${c.key}`,
            label: c.label,
            icon: c.type === 'number' ? HashIcon : c.type === 'date' ? CalendarIcon : TypeIcon,
            value: (r) => r.v[i] ?? null,
            format: c.format,
            amount: c.amount,
            filterable: true,
            groupable: c.type !== 'number',
            ...(c.type === 'number' ? { aggregate: c.format === 'percent' ? 'mean' : 'sum' } : {}),
            ...(i === symbolAt ? { chart: (r: FrameRow) => (r.v[i] ? String(r.v[i]) : null) } : {}),
            // Every cell but the key's edits in place; the frame keeps the value through every refresh.
            ...(editing && i !== keyAt && c.type !== 'date'
              ? {
                  edit: {
                    input: c.type === 'number' ? 'number' : 'text',
                    edited: (r: FrameRow) => editing.edited.has(editedKey(c.key, rowKey(r))),
                    save: (r: FrameRow, value: string | null) => {
                      const k = rowKey(r);
                      return editing.save({
                        ...(typeof k === 'number' ? { row: k } : { key: k }),
                        column: c.key,
                        value,
                      });
                    },
                  },
                }
              : {}),
          },
        ],
  );
  return {
    id: 'frame',
    rowKey: (r) => String(r.i),
    text: (r) => r.v.filter((x): x is string => typeof x === 'string'),
    groups: [
      {
        id: 'frame',
        label: `${meta.origin === 'yours' ? 'Yours' : assistant} · ${meta.name}`,
        color: frameColor(meta),
      },
    ],
    // A the assistant frame's columns are as of its last read (◷); the person's own are fixed.
    fields: fields.map((f) => ({
      group: 'frame',
      ...(meta.origin === 'yours' ? {} : { updates: 'asof' as const }),
      ...f,
    })),
    keys: {
      ...(symbolAt >= 0
        ? { symbol: (r: FrameRow) => (r.v[symbolAt] ? String(r.v[symbolAt]) : null) }
        : {}),
      ...(accountAt >= 0
        ? { account: (r: FrameRow) => (r.v[accountAt] ? String(r.v[accountAt]) : null) }
        : {}),
    },
  };
}

function FrameTab({
  api,
  tab,
  meta,
  crumbs,
  actions,
  intro,
  onChange,
}: {
  api: string;
  tab: WorkspaceTab;
  meta: FrameMeta;
  crumbs: Crumb[];
  actions: ReactNode;
  intro: ReactNode;
  onChange: (config: CustomViewConfig) => void;
}) {
  const qc = useQueryClient();
  const assistant = useAssistantName();
  const rows = useQuery({
    queryKey: frameKey(api, meta.id),
    queryFn: () => json<FrameData>(`${api}/frames/${meta.id}`),
  });
  const refresh = useMutation({
    mutationFn: () => json<FrameData>(`${api}/frames/${meta.id}/refresh`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(frameKey(api, meta.id), data);
      void qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, api, 'ws'] });
    },
  });
  // A frame refreshes only when the person taps ↻: opening a tab shows the
  // stored rows.
  const current = rows.data?.meta ?? meta;
  const reload = useLumenLoad(rows);
  const data: FrameRow[] = useMemo(
    () => (rows.data?.rows ?? []).map((v, i) => ({ i, v })),
    [rows.data],
  );
  const symbolAt = frameSymbolAt(current);
  const edits = useFrameEdits(api);
  const edited = useMemo(() => editedCells(rows.data), [rows.data]);
  // Where the app draws live quotes, a frame's own Price or Day % beside a symbol column is a
  // frozen copy that would hide the live one (frames saved before `frame.live_column`).
  const hasMarket = useHasMarket();
  const drop = useMemo(
    () => new Set(hasMarket ? liveQuoteColumns(current.columns).map((c) => c.key) : []),
    [hasMarket, current.columns],
  );
  const domain = useMemo(
    () =>
      frameDomain(
        current,
        symbolAt,
        {
          edited,
          save: (edit) => edits.mutateAsync({ id: current.id, edits: [edit] }),
        },
        drop,
        assistant,
      ),
    [current, symbolAt, edited, edits.mutateAsync, drop, assistant],
  );
  const config = useMemo(() => tab.config ?? frameConfig(current), [tab.config, current]);
  // The cause once, even from a frame stored before the server unwrapped it.
  const failed = (refresh.error?.message ?? current.error)?.replace(
    /^(?:(?:Code execution failed|Refresh failed):\s*)+/,
    '',
  );
  // The card's own ↻ runs the assistant's script again and its footer says when they last ran (per card, not the page header); rows the assistant wrote itself only reload.
  const runs = current.mode !== 'static' && current.origin !== 'yours';
  // The assistant's script as code to read and edit; a Your data column has none.
  const [scriptOpen, setScriptOpen] = useState(false);
  const assistantMade = current.origin !== 'yours';
  const load = useMemo(
    () => ({
      ...reload,
      updated: {
        at: Date.parse(current.at),
        error: failed ?? null,
        kind: runs
          ? current.mode === 'live'
            ? ('live' as const)
            : ('asof' as const)
          : ('fixed' as const),
        about:
          current.origin === 'yours'
            ? 'Your own data: you change it by typing.'
            : !runs
              ? `${assistant} wrote these rows once: nothing to run again.`
              : current.mode === 'asof'
                ? `${assistant}’s script reads the web, so it runs only when you ask.`
                : `${assistant}’s script reads live data.`,
      },
      ...(assistantMade ? { editScript: () => setScriptOpen(true) } : {}),
      ...(runs
        ? {
            fetching: reload.fetching || refresh.isPending,
            refreshing: reload.refreshing || refresh.isPending,
            refresh: async () => {
              await refresh.mutateAsync().catch(() => undefined);
            },
            refreshLabel:
              current.mode === 'asof'
                ? `Run ${assistant}’s script again (it reads the web, so only when you ask)`
                : `Run ${assistant}’s script again`,
          }
        : {}),
    }),
    [
      reload,
      current.at,
      current.mode,
      current.origin,
      failed,
      runs,
      assistantMade,
      assistant,
      refresh.isPending,
      refresh.mutateAsync,
    ],
  );
  return (
    <>
      <LumenLayout
        key={`frame:${tab.id}`}
        crumbs={crumbs}
        intro={intro}
        actions={actions}
        domain={domain}
        config={config}
        rows={data}
        onConfigChange={onChange}
        save="sheet"
        rowTitle={(r) => String(r.v[symbolAt >= 0 ? symbolAt : 0] ?? `Row ${r.i + 1}`)}
        load={load}
        status={
          <>
            <StatusItem label="Frame" value={current.name} />
            <StatusItem label="Rows" value={current.rows.toLocaleString('en-US')} />
            <StatusItem
              label="Kind"
              value={
                current.origin === 'yours'
                  ? `Your data, by ${current.key}`
                  : current.kind === 'linked'
                    ? `Linked by ${current.key}`
                    : 'Snapshot'
              }
            />
            {current.edited ? (
              <StatusItem label="Edited by hand" value={current.edited.toLocaleString('en-US')} />
            ) : null}
            <StatusItem
              label={
                current.kind === 'linked'
                  ? 'As of'
                  : current.mode === 'live'
                    ? 'Live, read'
                    : current.mode === 'asof'
                      ? 'As of'
                      : current.origin === 'yours'
                        ? 'Yours, changed'
                        : `Made by ${assistant}`
              }
              value={new Date(current.at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            />
            {failed ? (
              <StatusItem
                label="Refresh failed"
                className="min-w-0"
                value={
                  <span className="inline-block max-w-72 truncate align-bottom" title={failed}>
                    {failed}
                  </span>
                }
                ok={false}
              />
            ) : null}
          </>
        }
      />
      {assistantMade && (
        <FrameScriptDialog
          api={api}
          frame={current.id}
          name={current.name}
          open={scriptOpen}
          onOpenChange={setScriptOpen}
        />
      )}
    </>
  );
}

/** A tab's icon: the person's pick, else the assistant's mark on a frame, else a table. */
function tabIcon(t: WorkspaceTab) {
  return iconOf(t.config?.icon, 'frame' in t.source ? SparklesIcon : TableIcon);
}

/** A tab's layout as it shows: its own config, else its source's default. */
function tabConfig(
  t: WorkspaceTab,
  w: WorkspaceRead,
  defaultConfig: WorkspacesConfig['defaultConfig'],
): CustomViewConfig {
  if (t.config) return t.config;
  if ('frame' in t.source) {
    const meta = w.frames[t.source.frame];
    return { ...(meta ? frameConfig(meta) : customViewConfigSchema.parse({})), name: t.name };
  }
  const start = defaultConfig?.(t.source.domain);
  return { ...customViewConfigSchema.parse(start ?? {}), name: t.name };
}

/** A name for a workspace. */
function NameDialog({
  open,
  title,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(value);
  useEffect(() => {
    if (open) setName(value);
  }, [open, value]);
  const ok = name.trim().length > 0 && name.trim().length <= 60;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Up to 60 characters.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            onSave(name.trim());
            onClose();
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            aria-label="Name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
