// What a product tells its workspaces (apps, recipes), in its own module so Edit widget's + Data can
// read the recipes without importing the workspace pages.
import type { FrameScript } from '@columenlabs/lumen-ui-types/frames';
import type { CustomViewConfig, ViewFormula } from '@columenlabs/lumen-ui-types/views';
import { type ComponentType, createContext, useContext } from 'react';

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
  /** Recipes a person picks to start a tab by hand (+ in the tab bar); none hides the +. */
  recipes?: WorkspaceRecipe[];
}

/** A saved data pull a person can start a tab from: one call to one of the product's read tools. */
export interface WorkspaceRecipe {
  id: string;
  /** The tab's name and the picker's row: `Jobs scoring 70+`. */
  label: string;
  /** When to pick it, under the label. */
  description?: string;
  /** The picker's section: the app the rows come from. */
  group?: string;
  icon?: Icon;
  recipe: FrameScript;
  /** Formula columns the tab's layout starts with (dew point from temperature and humidity). */
  formulas?: ViewFormula[];
}
const ConfigCtx = createContext<WorkspacesConfig>({});
/** The product's apps and domains for its workspaces. */
export const WorkspacesProvider = ConfigCtx.Provider;

/** The product's workspace config; empty outside a WorkspacesProvider. */
export const useWorkspacesConfig = () => useContext(ConfigCtx);
