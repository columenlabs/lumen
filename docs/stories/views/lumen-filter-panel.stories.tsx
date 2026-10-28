import {
  type FilterField,
  LumenFilterPanel,
  LumenFilterPanelButton,
  LumenTokenizedFilter,
  useFilterPanel,
  useLumenFilter,
} from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { STORES, STORE_DOMAIN, type Store } from '../sample';

const fields: FilterField<Store>[] = STORE_DOMAIN.fields
  .filter((f) => f.filterable)
  .map((f) => ({
    key: f.key,
    label: f.label,
    icon: f.icon,
    values: (r) => [String(f.value(r))],
    number: typeof f.value(STORES[0] as Store) === 'number' ? (r) => Number(f.value(r)) : undefined,
  }));

function Demo() {
  const filter = useLumenFilter(STORES, fields, { text: (r) => [r.store] });
  const panel = useFilterPanel('story');
  return (
    <div className="flex items-start gap-3">
      <LumenFilterPanel
        filter={filter}
        {...panel}
        tips={{ [fields[0]?.key ?? '']: 'Counts leave this field’s own picks out.' }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <LumenFilterPanelButton filter={filter} {...panel} />
          <LumenTokenizedFilter filter={filter} className="min-w-0 flex-1" />
        </div>
        <p className="text-muted-foreground text-xs">
          {filter.results.length} of {STORES.length} stores:{' '}
          {filter.results.map((r) => r.store).join(', ')}
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: 'Components/Pages and views/LumenFilterPanel',
  component: LumenFilterPanel,
  parameters: {
    docs: {
      description: {
        component:
          'The filter box laid out as a panel: each field a section of values with counts, ticked in place. It shares `useLumenFilter`’s state with `LumenTokenizedFilter`, so a tick is a chip and a chip’s × unticks it. A field counts the rows the other fields keep. Over a server’s page pass the server’s counts as `facets` to `useLumenFilter` (or `LumenLayout facets`). Desktop: a side panel that hides to a filter icon; phone: a bottom sheet. On a page, use `LumenLayout filterPanel={{ id }}`.',
      },
    },
  },
  render: () => <Demo />,
} satisfies Meta<typeof LumenFilterPanel>;

export default meta;
export const Panel: StoryObj<typeof meta> = {
  args: { filter: undefined as never, open: true, onOpenChange: () => {} },
};
