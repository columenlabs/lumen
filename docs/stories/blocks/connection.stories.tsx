import {
  ConnectionLogo,
  type ConnectionWay,
  LumenConnection,
  LumenExpandList,
} from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlobeIcon, KeyRoundIcon, LogInIcon, MailIcon } from 'lucide-react';
import { useState } from 'react';

const meta = {
  title: 'Blocks/Connection',
  parameters: {
    docs: {
      description: {
        component:
          'One connection, one look: an AI provider, an email relay, an account, a connector. A row with one status pill opens to the ways it connects (pasted values, a sign-in that ends on an address the person pastes back, or the app’s own form). Two ways or more show radios and an In use tag. Each way set up shows Test, Remove (asks first) and Replace or Sign in again on the right.',
      },
    },
  },
} satisfies Meta;

export default meta;

const NOW = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const works = (detail: string) => ({ at: Date.now(), ok: true, detail });

/** A provider with a plan sign-in and an API key, both set, the plan in use. */
function Provider() {
  const [plan, setPlan] = useState<ConnectionWay['test'] | null>({
    at: NOW - 600_000,
    ok: true,
    detail: 'Plan sign-in works',
  });
  const [key, setKey] = useState<ConnectionWay['test'] | null>({
    at: NOW - 2 * 86_400_000,
    ok: true,
  });
  const [use, setUse] = useState('plan');
  return (
    <LumenConnection
      id="openai"
      name="OpenAI"
      logo={<ConnectionLogo text="O" />}
      use={use}
      onUse={async (w) => {
        await wait(300);
        setUse(w);
      }}
      ways={[
        {
          id: 'plan',
          label: 'ChatGPT plan',
          icon: LogInIcon,
          info: 'Run models on your own plan instead of an API key.',
          set: !!plan,
          ident: 'ada@example.com',
          test: plan,
          signin: {
            start: async () => ({
              url: 'https://example.com/authorize',
              redirect: 'http://127.0.0.1:1455/auth/callback',
            }),
            provider: 'ChatGPT',
          },
          onFinish: async () => {
            await wait(500);
            setPlan(works('Plan sign-in works'));
          },
          onTest: async () => {
            await wait(500);
            setPlan(works('Plan sign-in works'));
          },
          onRemove: async () => {
            await wait(300);
            setPlan(null);
            setUse('key');
          },
          removeTitle: 'Sign out of your ChatGPT plan?',
          removeText: 'Your API key, if you set one, runs from then on.',
          removeLabel: 'Sign out',
        },
        {
          id: 'key',
          label: 'API key',
          icon: KeyRoundIcon,
          set: !!key,
          ident: 'sk-proj…f3Ab',
          test: key,
          fields: [{ id: 'key', label: 'OpenAI API key', secret: true, prefix: 'sk-' }],
          getUrl: 'https://example.com/keys',
          onSave: async () => {
            await wait(500);
            setKey(works('The key works'));
          },
          onTest: async () => {
            await wait(500);
            setKey(works('The key works'));
          },
          onRemove: async () => {
            await wait(300);
            setKey(null);
          },
        },
      ]}
    />
  );
}

/** One key that failed its last test. */
function Failing() {
  const [test, setTest] = useState<ConnectionWay['test']>({
    at: NOW - 3_600_000,
    ok: false,
    error: 'The provider refused the key: it was revoked.',
    expired: true,
  });
  return (
    <LumenConnection
      id="anthropic"
      name="Anthropic"
      logo={<ConnectionLogo text="A" />}
      ways={[
        {
          id: 'key',
          label: 'API key',
          icon: KeyRoundIcon,
          set: true,
          ident: 'sk-ant-…7Qx2',
          test,
          fields: [{ id: 'key', label: 'Anthropic API key', secret: true, prefix: 'sk-ant-' }],
          onSave: async () => {
            await wait(500);
            setTest(works('The key works'));
          },
          onTest: async () => {
            await wait(500);
          },
          onRemove: async () => wait(300),
        },
      ]}
    />
  );
}

/** Not set up yet: two values to paste. */
function NotSet() {
  const [set, setSet] = useState(false);
  return (
    <LumenConnection
      id="search"
      name="Search connector"
      logo={<ConnectionLogo icon={GlobeIcon} />}
      ways={[
        {
          id: 'token',
          label: 'Service token',
          icon: KeyRoundIcon,
          set,
          ident: set ? 'a1b2c3d…' : undefined,
          test: set ? works('Answered with 4 tools') : null,
          fields: [
            { id: 'client_id', label: 'Client ID' },
            { id: 'client_secret', label: 'Client Secret', secret: true },
          ],
          onSave: async () => {
            await wait(500);
            setSet(true);
          },
          onTest: async () => wait(500),
          onRemove: async () => {
            await wait(300);
            setSet(false);
          },
        },
      ]}
    />
  );
}

/** The app's own settings below the way. */
function WithLines() {
  return (
    <LumenConnection
      id="email"
      name="Email relay"
      logo={<ConnectionLogo icon={MailIcon} />}
      ways={[
        {
          id: 'api',
          label: 'Email API',
          icon: KeyRoundIcon,
          set: true,
          ident: 're_…9kQz',
          test: { at: NOW - 20 * 60_000, ok: true, detail: 'Connection checked' },
          readOnly: true,
          onTest: async () => wait(500),
        },
      ]}
      lines={[
        { label: 'Reached through', value: 'Private tunnel' },
        { label: 'Server', value: 'http://localhost:20003/api', mono: true },
        { label: 'Sent from', value: 'Hub <hello@example.com>' },
      ]}
    />
  );
}

/** Every kind together, as a settings page lists them: one row open at a time. */
export const Connections: StoryObj = {
  render: () => (
    <div className="max-w-2xl">
      <LumenExpandList defaultOpen="openai">
        <Provider />
        <Failing />
        <NotSet />
        <WithLines />
      </LumenExpandList>
    </div>
  ),
};
