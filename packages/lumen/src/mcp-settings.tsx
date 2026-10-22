import { CheckIcon, CopyIcon, ShieldIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
// Settings ▸ MCP (in Lumen for
// every app): each MCP server's address and the steps to connect it from each
// client. Sign-in is OAuth only (no API keys); a client that can't sign in back to the app runs the
// common `mcp-remote` bridge on the person's own computer, whose sign-in returns to localhost.
import { LumenSelector } from './lumen-selector';
import { IconButton } from './page';
import { SettingRow } from './settings';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

/** One MCP server the app offers. */
export interface McpServer {
  id: string;
  /** Its name in lists and steps (an app). */
  label: string;
  /** Its whole address. */
  url: string;
  /** The name clients keep it under (`myapp-main`). */
  key: string;
  /** More steps for scripts (pushing data in), and an example to paste. */
  script?: { steps?: ReactNode; example?: string };
}

const CLIENTS = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  code: 'Claude Code',
  cursor: 'Cursor',
  other: 'Other app',
  script: 'Script',
} as const;
type Client = keyof typeof CLIENTS;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    });
  return { copied, copy };
}

/** A command or config to paste, with Copy in its corner. */
function Snippet({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative">
      <pre className="rounded-md border bg-muted/40 p-3 pr-10 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {text}
      </pre>
      <IconButton
        icon={copied === text ? CheckIcon : CopyIcon}
        size="icon-xs"
        label="Copy"
        className="absolute top-2 right-2"
        onClick={() => copy(text)}
      />
    </div>
  );
}

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">{children}</ol>
);

/** The steps for one client and server. */
function ClientSteps({ client, server }: { client: Client; server: McpServer }) {
  const { url, key: name } = server;
  const bridge = JSON.stringify(
    { mcpServers: { [name]: { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    null,
    2,
  );
  switch (client) {
    case 'claude':
      return (
        <Steps>
          <li>In Claude, open Settings ▸ Connectors and press Add custom connector.</li>
          <li>
            Name it {server.label}, paste the {server.label} address and press Add.
          </li>
          <li>Press Connect and sign in when your browser opens.</li>
        </Steps>
      );
    case 'chatgpt':
      return (
        <Steps>
          <li>
            In ChatGPT, open Settings ▸ Apps &amp; Connectors ▸ Advanced settings and turn on
            Developer mode.
          </li>
          <li>
            Back in Apps &amp; Connectors, press Create, name it {server.label}, paste the address
            and pick OAuth.
          </li>
          <li>Sign in when your browser opens.</li>
        </Steps>
      );
    case 'code':
      return (
        <div className="flex flex-col gap-2">
          <Steps>
            <li>Run this in a terminal.</li>
            <li>
              Type <code className="font-mono text-xs">/mcp</code> in Claude Code and pick {name}.
              Your browser opens; sign in.
            </li>
          </Steps>
          <Snippet text={`claude mcp add --transport http ${name} ${url}`} />
        </div>
      );
    case 'cursor':
      return (
        <div className="flex flex-col gap-2">
          <Steps>
            <li>
              Add this to <code className="font-mono text-xs">~/.cursor/mcp.json</code>.
            </li>
            <li>In Cursor Settings ▸ MCP, press Needs login beside {name} and sign in.</li>
          </Steps>
          <Snippet text={JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2)} />
        </div>
      );
    case 'other':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Apps that sign in through the browser take the address as is. An app whose sign-in can
            only return to its own website runs the bridge on your computer instead: the app talks
            to the bridge, the bridge signs in through your browser and talks to {server.label}.
          </p>
          <Steps>
            <li>Add this server to the app's MCP config (Node.js needed).</li>
            <li>Start the app; your browser opens once to sign in.</li>
          </Steps>
          <Snippet text={bridge} />
        </div>
      );
    case 'script':
      return (
        <div className="flex flex-col gap-2">
          <Steps>
            <li>Sign in once on the computer the script runs on; the sign-in is kept there.</li>
            <li>
              Point the script's MCP client at the same command (stdio). Later runs need no browser.
            </li>
            {server.script?.steps}
          </Steps>
          <Snippet text={`npx -y mcp-remote ${url}`} />
          {server.script?.example && <Snippet text={server.script.example} />}
        </div>
      );
  }
}

export function McpSettings({ servers, current }: { servers: McpServer[]; current?: string }) {
  const { copied, copy } = useCopy();
  const [serverId, setServerId] = useState(current ?? servers[0]?.id);
  const [client, setClient] = useState<Client>('claude');
  const server = servers.find((d) => d.id === serverId) ?? servers[0];
  if (!server) return null;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col">
        <h4 className="text-xs font-medium text-muted-foreground">Servers</h4>
        {servers.map((d) => {
          const url = d.url;
          return (
            <SettingRow key={d.id} label={d.label} description="MCP address">
              <InputGroup className="w-56 sm:w-80">
                <InputGroupInput
                  readOnly
                  value={url}
                  aria-label={`${d.label} MCP address`}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`Copy the ${d.label} address`}
                    onClick={() => copy(url)}
                  >
                    {copied === url ? <CheckIcon /> : <CopyIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </SettingRow>
          );
        })}
      </section>
      <section className="flex flex-col gap-3">
        <h4 className="text-xs font-medium text-muted-foreground">Connect</h4>
        <div className="flex flex-wrap items-center gap-2">
          {servers.length > 1 && (
            <LumenSelector
              label="Server"
              size="sm"
              className="w-40"
              options={servers.map((d) => ({ value: d.id, label: d.label }))}
              value={server.id}
              onChange={setServerId}
            />
          )}
          <LumenSelector
            label="App"
            size="sm"
            className="w-36 md:hidden"
            options={Object.entries(CLIENTS).map(([k, label]) => ({ value: k, label }))}
            value={client}
            onChange={(v) => setClient(v as Client)}
          />
        </div>
        <Tabs
          value={client}
          onValueChange={(v) => setClient(v as Client)}
          className="max-md:hidden"
        >
          <TabsList>
            {Object.entries(CLIENTS).map(([k, label]) => (
              <TabsTrigger key={k} value={k}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ClientSteps client={client} server={server} />
      </section>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
        Every client signs in as you through your browser; there are no API keys. Sign-ins return
        only to known apps and to http://localhost or http://127.0.0.1 on your own computer.
      </p>
    </div>
  );
}
