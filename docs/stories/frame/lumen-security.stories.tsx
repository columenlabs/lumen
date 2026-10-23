import { LumenSecondStep, LumenSignInMethods } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** A sample setup link; the secret is the RFC 4226 test key, never a real one. */
const SAMPLE_URI = 'otpauth://totp/Example:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
const SAMPLE_CODES = Array.from({ length: 10 }, (_, i) => `sample-${String(i).padStart(2, '0')}`);

function Methods() {
  const [passkeys, setPasskeys] = useState([
    { id: 'a', name: 'Laptop', createdAt: '2026-10-23' },
    { id: 'b', name: 'Security key', createdAt: '2026-10-23' },
  ]);
  const [app, setApp] = useState(false);
  const [email, setEmail] = useState(true);
  return (
    <div className="max-w-2xl">
      <LumenSignInMethods
        password={{ onChange: () => {} }}
        passkeys={{
          list: passkeys,
          onAdd: async (name) => {
            await wait();
            setPasskeys((p) => [...p, { id: String(p.length), name, createdAt: '2026-10-23' }]);
          },
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
        backup={{ left: 8, onRenew: async () => SAMPLE_CODES }}
      />
    </div>
  );
}

const meta = {
  title: 'Frame/Two-step sign-in',
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
      />
    </div>
  ),
};
