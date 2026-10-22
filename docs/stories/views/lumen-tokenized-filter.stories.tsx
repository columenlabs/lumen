import { type FilterField, LumenTokenizedFilter, useLumenFilter } from '@columenlabs/lumen-ui';
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
  return (
    <div className="flex flex-col gap-3">
      <LumenTokenizedFilter filter={filter} />
      <p className="text-muted-foreground text-xs">
        {filter.results.length} of {STORES.length} stores:{' '}
        {filter.results.map((r) => r.store).join(', ')}
      </p>
    </div>
  );
}

const meta = {
  title: 'Pages and views/LumenTokenizedFilter',
  component: LumenTokenizedFilter,
  parameters: {
    docs: {
      description: {
        component:
          'The filter box: type to search, or pick `field:value` chips grouped by field with counts. Number fields take one condition (`> 100`, `a..b`). `useLumenFilter` holds the state and returns the matching rows.',
      },
    },
  },
  render: () => <Demo />,
} satisfies Meta<typeof LumenTokenizedFilter>;

export default meta;
export const Filter: StoryObj<typeof meta> = { args: { filter: undefined as never } };
