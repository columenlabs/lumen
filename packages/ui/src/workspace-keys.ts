import type { WorkspaceSummary } from '@columenlabs/lumen-ui-types/workspaces';
import { apiJson } from './api-fetch';

// Query keys of frames and the workspaces that show them, shared by every card that attaches a
// frame, a product's workspace page and its assistant (whose tab moves and remade frames
// invalidate them).

/** Every workspace query's key starts here: the assistant's tab moves invalidate them all. */
export const WORKSPACES_KEY = ['workspaces'] as const;
/** A frame's rows; a remade frame invalidates it. */
export const frameKey = (api: string, id: string) => [...WORKSPACES_KEY, api, 'frame', id];

/** The workspaces as the sidebar and the @ picker list them. */
export const workspacesListQuery = (api: string) => ({
  queryKey: [...WORKSPACES_KEY, api, 'list'],
  queryFn: () =>
    apiJson<{ workspaces: WorkspaceSummary[] }>(`${api}/workspaces`, {}, 'workspaces.list'),
});
