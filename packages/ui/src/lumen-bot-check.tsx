// The bot check on signed-out forms: Cloudflare Turnstile, out of sight unless it is unsure, when
// it asks for one click. Each token works once, so a form bumps `version` after every try.
import { Turnstile } from '@marsidev/react-turnstile';

/** Renders nothing without a site key, so an app can ship it before its keys are set. */
export function LumenBotCheck({
  siteKey,
  onToken,
  version,
}: {
  siteKey: string | null | undefined;
  /** The token to send with the form, or null when it expired or failed. */
  onToken: (token: string | null) => void;
  /** Bump to get a fresh token after a try. */
  version: number;
}) {
  if (!siteKey) return null;
  return (
    <Turnstile
      key={version}
      siteKey={siteKey}
      options={{ size: 'flexible', appearance: 'interaction-only' }}
      onSuccess={onToken}
      onExpire={() => onToken(null)}
      onError={() => onToken(null)}
    />
  );
}
