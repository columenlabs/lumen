import { LumenSecondStep, LumenSessions, LumenSignInMethods } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** A sample setup link; the secret is the RFC 4226 test key, never a real one. */
const SAMPLE_URI = 'otpauth://totp/Example:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
const SAMPLE_CODES = Array.from({ length: 10 }, (_, i) => `sample-${String(i).padStart(2, '0')}`);

function Methods({ passwordless = false }: { passwordless?: boolean }) {
  const [passkeys, setPasskeys] = useState([
    { id: 'a', name: 'Laptop', createdAt: '2026-10-23' },
    { id: 'b', name: 'Security key', createdAt: '2026-10-23' },
  ]);
  const [app, setApp] = useState(false);
  const [email, setEmail] = useState(true);
  return (
    <div className="max-w-2xl">
      <LumenSignInMethods
        passwordless={passwordless}
        password={passwordless ? undefined : { onChange: () => {} }}
        passkeys={{
          list: passkeys,
          // Name it "cancel" to see a closed prompt, "wait" for a device that never answers (Cancel ends it).
          onAdd: async (name) => {
            if (name === 'wait') return new Promise(() => {});
            await wait();
            if (name === 'cancel') {
              return {
                error: {
                  code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
                  message: 'The operation either timed out or was not allowed.',
                },
              };
            }
            setPasskeys((p) => [...p, { id: String(p.length), name, createdAt: '2026-10-23' }]);
          },
          onCancel: () => {},
          onRemove: async (id) => setPasskeys((p) => p.filter((k) => k.id !== id)),
        }}
        app={{
          on: app,
          onStart: async (password) => {
            await wait();
            return password === 'wrong'
              ? 'That password didn’t match.'
              : { uri: SAMPLE_URI, backupCodes: SAMPLE_CODES };
          },
          onConfirm: async (code) => {
            await wait();
            if (code !== '123456') return 'Enter 123456 in this demo.';
            setApp(true);
          },
          onTurnOff: async () => setApp(false),
        }}
        email={{ to: 'you@example.com', on: email, onToggle: async (on) => setEmail(on) }}
        backup={app ? { left: 8, onRenew: async () => SAMPLE_CODES } : undefined}
      />
    </div>
  );
}

const SESSIONS = [
  { id: '1', name: 'Chrome on macOS', lastUsed: '2026-11-23', current: true },
  { id: '2', name: 'Safari on iPhone', lastUsed: '2026-11-22' },
  { id: '3', name: 'Safari on iPhone', lastUsed: '2026-11-22' },
  { id: '4', name: 'Safari on iPhone', lastUsed: '2026-11-21' },
  { id: '5', name: 'Chrome on macOS', lastUsed: '2026-11-21' },
  { id: '6', name: 'Chrome on macOS', lastUsed: '2026-11-20' },
  {
    id: '7',
    name: 'Firefox on Windows with a very long browser and system name that cuts off',
    lastUsed: '2026-11-19',
  },
];

function Sessions() {
  const [list, setList] = useState(SESSIONS);
  return (
    <div className="max-w-2xl">
      <LumenSessions
        list={list}
        onSignOut={async (ids) => setList((l) => l.filter((s) => !ids.includes(s.id)))}
        onSignOutHere={() => {}}
        onSignOutOthers={async () => setList((l) => l.filter((s) => s.current))}
      />
    </div>
  );
}

const meta = {
  title: 'Blocks/Sign-in',
  component: LumenSignInMethods,
  parameters: {
    docs: {
      description: {
        component:
          'Settings ▸ General ▸ Security (pass it to LumenShell as `security`) and the second step of a sign-in. The parts draw the screens and call the app back; each callback answers a problem to show, or anything else when it worked. Adding a passkey, setting up an authenticator app (QR code, then backup codes) and making new backup codes open in place.',
      },
    },
  },
  args: {},
  render: () => <Methods />,
} satisfies Meta<typeof LumenSignInMethods>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignInMethods: Story = {};

/** An app with no passwords (passkeys, Google, emailed codes): no password step anywhere. */
export const Passwordless: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col">
      <Methods passwordless />
      <Sessions />
    </div>
  ),
};

/** Where the person is signed in: the same device name shows once, ×N. */
export const Devices: Story = { render: () => <Sessions /> };

export const SecondStep: Story = {
  render: () => (
    <div className="max-w-sm">
      <LumenSecondStep
        methods={{ passkey: true, app: true, email: true, backup: true }}
        initial="app"
        emailTo="y••@example.com"
        onPasskey={async () => {
          await wait();
          return 'No passkey answered. Enter a code instead.';
        }}
        onSendEmail={wait}
        onVerify={async (_, code) => (code === '123456' ? undefined : 'That code didn’t work.')}
        onBack={() => {}}
        trust={{ checked: true, onCheckedChange: () => {}, days: 30 }}
      />
    </div>
  ),
};
