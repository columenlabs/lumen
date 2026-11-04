// The data a widget can take as its main data: this page's rows, the app's live domains with a
// reader, the person's recipes, and the product's recipes not yet made (by app). Add widget's
// first step and Edit widget ▸ Data both pick from it.
import {
  CATALOG,
  FRAME_LINK,
  catalogKeys,
  readableDomain,
} from '@columenlabs/lumen-ui-types/catalog';
import type { FrameChoice } from '@columenlabs/lumen-ui-types/frames';
import { DatabaseIcon, SparklesIcon, TableIcon } from 'lucide-react';
import { asOf, useFrameChoices, useMakeFrame } from './joins';
import type { LumenOption } from './lumen-selector';
import { lumenToast } from './lumen-toast';
import { useApp } from './shell';
import { type WorkspaceRecipe, useWorkspacesConfig } from './workspaces-config';

/** The page's own rows, as a data option's value. */
export const PAGE_SOURCE = '_page';
/** A product recipe not made yet, as a data option's value: picking it runs it once. */
export const MAKE_RECIPE = 'make:';

/**
 * The product's recipes (WorkspacesProvider `recipes`) the person has no frame of yet, as options
 * grouped by the app they read. A recipe already made shows once, as the person's recipe.
 */
export function recipeOptions(
  recipes: readonly WorkspaceRecipe[],
  made: readonly FrameChoice[],
): LumenOption[] {
  const names = new Set(made.map((f) => f.name));
  return recipes
    .filter((r) => !names.has(r.label))
    .map((r) => ({
      value: `${MAKE_RECIPE}${r.id}`,
      label: r.label,
      group: r.group ?? 'Recipes',
      ...(r.description ? { detail: r.description } : {}),
      icon: r.icon ?? SparklesIcon,
      keywords: [r.group ?? '', r.description ?? ''],
    }));
}

/** Turns a picked product recipe into its frame (made once, then reused). */
export function useMakeRecipe() {
  const { recipes = [] } = useWorkspacesConfig();
  const make = useMakeFrame();
  const run = async (value: string): Promise<FrameChoice | null> => {
    const r = recipes.find((x) => `${MAKE_RECIPE}${x.id}` === value);
    if (!r) return null;
    try {
      return await make.mutateAsync({ name: r.label, recipe: r.recipe });
    } catch (e) {
      lumenToast.error(`Couldn’t pull ${r.label}: ${(e as Error).message}`);
      return null;
    }
  };
  return { run, pending: make.isPending, recipes };
}

export function useWidgetDataOptions(enabled: boolean, pageLabel: string): LumenOption[] {
  const app = useApp();
  const choices = useFrameChoices(enabled);
  const { recipes = [] } = useWorkspacesConfig();
  return [
    { value: PAGE_SOURCE, label: pageLabel, group: 'This page', icon: TableIcon },
    ...Object.entries(CATALOG)
      .filter(([id, d]) => d.desk === app?.id && d.status === 'live' && readableDomain(id))
      .map(([id, d]) => ({
        value: id,
        label: d.label,
        group: `${app?.label ?? 'This app'} data`,
        detail: catalogKeys(id).join(', ') || undefined,
        icon: DatabaseIcon,
        keywords: [d.about],
      })),
    ...(choices.data ?? []).map((f) => ({
      value: `${FRAME_LINK}${f.id}`,
      label: f.name,
      group: 'Recipes',
      detail: asOf(f.at),
      icon: SparklesIcon,
    })),
    ...recipeOptions(recipes, choices.data ?? []),
  ];
}
