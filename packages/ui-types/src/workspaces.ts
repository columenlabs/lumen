import { z } from 'zod';
// Workspaces (in Lumen): an assistant produces data, Lumen
// renders it. The assistant keeps what it finds as named frames (rows and the script that made
// them, `./frames`); a workspace is a page of tabs, each tab one card: a view config over one
// source, a frame or one of the app's own data domains. The person edits a tab like any view and
// keeps it until they delete it. Each workspace belongs to one app of the product (`app`: one
// of its apps), whose sidebar lists it.
import type { CustomViewConfig } from './views';

/** A workspace's or tab's name. */
export const workspaceName = z.string().trim().min(1).max(60);
/** A workspace's id: the assistant and the browser address workspaces by it, never by name. */
export const workspaceId = z
  .string()
  .trim()
  .regex(/^ws_[a-f0-9]{16}$/, 'a workspace id (ws_…) from "On screen" or an earlier card');
/** A tab's id (unique across a person's workspaces). */
export const tabId = z
  .string()
  .trim()
  .regex(/^tb_[a-f0-9]{16}$/, 'a tab id (tb_…) from "On screen" or an earlier card');

/**
 * A card's source: a frame (by id), or one of the app's own data domains, drawn live as the person
 * (an app's holdings, lots, transactions, accounts, symbols).
 */
export type TabSource = { frame: string } | { domain: string };

/** A workspace tab: one card, a view config over its source. */
export interface WorkspaceTab {
  id: string;
  name: string;
  source: TabSource;
  /** The layout: the person's and the assistant's edits; null reads the source's default. */
  config: CustomViewConfig | null;
}

export interface Workspace {
  id: string;
  name: string;
  /** The app it belongs to. */
  app: string;
  tabs: WorkspaceTab[];
  created_at: string;
  updated_at: string;
}

/** A workspace as the sidebar lists it. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  /** The app it belongs to. */
  app: string;
  tabs: { id: string; name: string; kind: 'frame' | 'domain' }[];
  updated_at: string;
}

/** A workspace's page, and one tab on it. */
export const workspacePath = (id: string, tab?: string) =>
  `/workspaces/${id}${tab ? `?tab=${tab}` : ''}`;

/** What a card move did to a tab, kept on its screen call so Undo can put it back. */
export interface TabEffect {
  workspace: string;
  /** The tab; left out for a move on the workspace itself (rename, delete). */
  tab?: string;
  /** The workspace was made by this move. */
  made_workspace?: true;
  /** The tab before the move; absent when the move made it. */
  before?: WorkspaceTab;
  /** The tab was deleted from this place (Undo puts `before` back there). */
  removed_at?: number;
  /** The tab was moved from this place. */
  moved_from?: number;
  /** The workspace's name before a rename. */
  renamed_from?: string;
  /** The workspace as it was before it was deleted. */
  removed_workspace?: Workspace;
}
