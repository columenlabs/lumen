import {
  FactList,
  LumenExpandList,
  LumenExpandRow,
  LumenLoading,
  LumenView,
  SettingField,
  SettingValue,
  Tile,
  TileRow,
} from '@columenlabs/lumen-ui';
import { Switch } from '@columenlabs/lumen-ui/ui/switch';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyRoundIcon, SmartphoneIcon } from 'lucide-react';
import { STORES, STORE_DOMAIN, storeView } from '../sample';

function Screen({ loading }: { loading: boolean }) {
  return (
    <LumenLoading loading={loading} className="grid max-w-3xl gap-4 p-4">
      <TileRow fill>
        <Tile label="Revenue" value="$1,257,027" caption="this month" />
        <Tile label="Orders" value="18,097" lines={['+4.1% on last month']} />
        <Tile label="Stores" value="24" />
      </TileRow>
      <div className="rounded-lg border px-3">
        <LumenExpandList>
          <LumenExpandRow
            id="passkeys"
            name="Passkeys"
            meta="2 passkeys"
            health="works"
            icon={<KeyRoundIcon className="size-5" />}
          >
            <SettingField label="Name">
              <SettingValue value="MacBook" label="Name" />
            </SettingField>
          </LumenExpandRow>
          <LumenExpandRow
            id="app"
            name="Authenticator app"
            meta="8 backup codes left"
            health="works"
            icon={<SmartphoneIcon className="size-5" />}
            toggle={{ checked: true, onCheckedChange: () => {}, label: 'Authenticator app' }}
          >
            <SettingField label="Codes">8 left</SettingField>
          </LumenExpandRow>
        </LumenExpandList>
      </div>
      <div className="rounded-lg border px-3">
        <LumenExpandList id="story-devices">
          {['MacBook Pro', 'iPhone', 'iPad'].map((d) => (
            <LumenExpandRow key={d} id={d} name={d} meta="Signed in today">
              <SettingField label="Last seen">today</SettingField>
            </LumenExpandRow>
          ))}
        </LumenExpandList>
      </div>
      <div className="rounded-lg border px-3 py-1">
        <SettingField label="Session ends">
          <SettingValue value="11/25/2026, 5:34 AM" label="Session ends" />
        </SettingField>
        <SettingField label="Email alerts" end={<Switch checked aria-label="Email alerts" />} />
      </div>
      <FactList
        facts={[
          { label: 'Email', value: 'dev@example.com' },
          { label: 'Signs in with', value: 'Cloudflare Access' },
        ]}
      />
      <LumenView
        domain={STORE_DOMAIN as never}
        config={storeView()}
        rows={(loading ? [] : STORES.slice(0, 6)) as never}
        cardId="story-loading"
      />
    </LumenLoading>
  );
}

const meta = {
  title: 'Components/Feedback/LumenLoading',
  component: Screen,
  parameters: {
    docs: {
      description: {
        component:
          'Wraps the parts a screen draws from its reads. While they run, each part draws its own shape with bars: rows keep their names, fields and tiles their labels, a table its header and row count. Nothing is empty until a read answers.',
      },
    },
  },
  args: { loading: true },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const Settled: Story = { args: { loading: false } };
