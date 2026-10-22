// Built-in pages are each person's to change: an app view (defined in code)
// opens as the person left it, saves their edits as their own copy and goes back to its default
// with Reset to default. It is never deleted. One hook for every app: `/api/app-views` answers on
// each app host.
import type { CustomView, CustomViewConfig } from '@columenlabs/lumen-types/views';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJson } from './api-fetch';

const BASE = '/api/app-views';

/** What a page passes to LumenLayout for an app view: the view as this person has it, its save and its reset. */
/** An app view as `appView` gives it, or as an app keeps it with its dates. */
type AnyView = Omit<CustomView, 'created_at' | 'updated_at'>;

export interface AppViewState<V extends AnyView> {
  view: V | undefined;
  /** Saves the person's version of the page. */
  onConfigChange?: (config: CustomViewConfig) => void;
  /** Puts the page back to its default; only once the person has changed it. */
  onReset?: () => void;
}

/**
 * The person's version of `app` (an app view from `appView`, undefined when the page shows another
 * view): drawn from the code at once, then from the server once read. `enabled` false keeps the
 * code's (a page that is a workspace tab, an app without the store).
 */
export function useAppView<V extends AnyView>(app: V | undefined, enabled = true): AppViewState<V> {
  const qc = useQueryClient();
  const url = app && `${BASE}/${app.domain}/${app.id}`;
  const key = ['app-view', app?.domain, app?.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiJson<V>(url as string, {}, 'app_view.read'),
    enabled: !!app && enabled,
  });
  const put = (v: V) => qc.setQueryData(key, v);
  const save = useMutation({
    mutationFn: (config: CustomViewConfig) =>
      apiJson<V>(
        url as string,
        { method: 'PUT', body: JSON.stringify({ config }) },
        'app_view.save',
      ),
    onMutate: (config) => {
      const now = q.data ?? app;
      if (now) put({ ...now, config: config as V['config'], customized: true });
    },
    onSuccess: put,
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });
  const reset = useMutation({
    mutationFn: () => apiJson<V>(url as string, { method: 'DELETE' }, 'app_view.reset'),
    onSuccess: put,
  });
  if (!app || !enabled) return { view: app };
  const view = q.data ?? app;
  return {
    view,
    onConfigChange: (config) => save.mutate(config),
    onReset: view.customized ? () => reset.mutate() : undefined,
  };
}
