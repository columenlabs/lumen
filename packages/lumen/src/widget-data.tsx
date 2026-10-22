// The data a widget can take as its main data: this page's rows, the app's live domains with a
// reader, and the person's recipes. Add widget's first step and Edit widget ▸ Data both pick from it.
import {
  CATALOG,
  FRAME_LINK,
  catalogKeys,
  readableDomain,
} from '@columenlabs/lumen-ui-types/catalog';
import { DatabaseIcon, SparklesIcon, TableIcon } from 'lucide-react';
import { asOf, useFrameChoices } from './joins';
import type { LumenOption } from './lumen-selector';
import { useApp } from './shell';

/** The page's own rows, as a data option's value. */
export const PAGE_SOURCE = '_page';

export function useWidgetDataOptions(enabled: boolean, pageLabel: string): LumenOption[] {
  const app = useApp();
  const choices = useFrameChoices(enabled);
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
  ];
}
