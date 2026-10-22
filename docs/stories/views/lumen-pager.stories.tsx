import { LumenPager } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';

const meta = {
  title: 'Pages and views/LumenPager',
  component: LumenPager,
  parameters: {
    docs: {
      description: {
        component:
          'The compact pager every table uses: the count opens the page sizes, the chevrons turn the page.',
      },
    },
  },
  args: { total: 240, page: 0, size: 25, noun: 'rows', onPage: () => {}, onSize: () => {} },
  render: function Render(args) {
    const [, update] = useArgs();
    return (
      <LumenPager
        {...args}
        onPage={(page) => update({ page })}
        onSize={(size) => update({ size, page: 0 })}
      />
    );
  },
} satisfies Meta<typeof LumenPager>;

export default meta;
export const Pager: StoryObj<typeof meta> = {};
