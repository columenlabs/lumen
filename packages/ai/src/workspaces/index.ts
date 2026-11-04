/**
 * Workspaces: a person's pages of tabs, each a table over rows a recipe pulled, run again on demand.
 * `createWorkspaces` is the store (any SQLite), `workspaceRoutes` the HTTP the kit's pages call.
 */
export {
  CSV_BYTES,
  FrameError,
  applyEdits,
  asObjects,
  asRows,
  coerce,
  dedupeEdits,
  parseCsv,
  toFrame,
} from './frame';
export type { Row } from './frame';
export {
  FRAME_BYTES,
  MAX_FRAMES,
  MAX_TABS,
  MAX_WORKSPACES,
  RUN_MS,
  createWorkspaces,
  d1Sql,
  doSql,
  recipeText,
  workspaceMigrations,
} from './store';
export type {
  RecipeRunner,
  SqlRunner,
  WorkspaceRead,
  WorkspaceTables,
  Workspaces,
  WorkspacesOptions,
} from './store';
export { workspaceRoutes } from './routes';
export { SANDBOX_CSP, SANDBOX_HTML, sandboxResponse } from './sandbox';
export type { WorkspaceRoutesOptions } from './routes';
