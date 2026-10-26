// What an invite link opens: who invited them and to what, then Accept. An expired link, a link for
// another email or one that no longer works each say so, with the way forward.
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckIcon, LogOutIcon, MailWarningIcon, UserPlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../api-fetch';
import { errorText } from '../integrations';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';
import { Spinner } from '../ui/spinner';
import type { PeopleAdapter } from './client';
import { when } from './shared';

export function LumenInviteAccept({
  adapter,
  token,
  onAccepted,
  onSwitchAccount,
}: {
  adapter: PeopleAdapter;
  token: string;
  /** After Accept: open the app. */
  onAccepted: () => void;
  /** Signs out so they can sign in with the invited email. */
  onSwitchAccount?: () => void;
}) {
  const q = useQuery({
    queryKey: ['lumen-people', adapter.key, 'invite', token],
    queryFn: () =>
      adapter.invitation?.(token) ?? Promise.reject(new Error('Invites are not set up here.')),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      adapter.accept?.(token) ?? Promise.reject(new Error('Invites are not set up here.')),
    onSuccess: onAccepted,
  });
  const inv = q.data;

  if (q.isPending) return <Screen icon={<Spinner />} title="Opening your invite…" />;
  if (!inv)
    return (
      <Screen
        icon={<MailWarningIcon />}
        title="This invite link does not work"
        text={
          q.error instanceof ApiError && q.error.status === 404
            ? 'It was used already, replaced by a newer invite, or revoked. Ask the person who invited you for a new one.'
            : errorText(q.error)
        }
      />
    );
  if (inv.status === 'expired')
    return (
      <Screen
        icon={<MailWarningIcon />}
        title={`This invite expired ${when(inv.expiresAt)}`}
        text={`Ask ${inv.invitedBy ?? 'the person who invited you'} to resend it. A new link works again from the day it is sent.`}
      />
    );
  if (inv.signedInAs.toLowerCase() !== inv.email)
    return (
      <Screen
        icon={<MailWarningIcon />}
        title="This invite is for another email"
        text={`It is for ${inv.email}. You are signed in as ${inv.signedInAs}.`}
        action={
          onSwitchAccount && (
            <Button size="sm" onClick={onSwitchAccount}>
              <LogOutIcon /> Switch account
            </Button>
          )
        }
      />
    );
  return (
    <Screen
      icon={<UserPlusIcon />}
      title={`Join ${inv.appName}`}
      text={`${inv.invitedBy ?? 'An admin'} invited ${inv.email}. You’ll get:`}
      action={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-1.5">
            {inv.access.map((a) => (
              <Badge key={a} variant="secondary">
                {a}
              </Badge>
            ))}
          </div>
          {accept.isError && <p className="text-destructive text-sm">{errorText(accept.error)}</p>}
          <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending ? <Spinner /> : <CheckIcon />} Accept and open
          </Button>
          {inv.expiresAt && (
            <span className="text-muted-foreground text-xs">
              The link works until {when(inv.expiresAt)}.
            </span>
          )}
        </div>
      }
    />
  );
}

function Screen({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Empty className="max-w-md border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {text && <EmptyDescription>{text}</EmptyDescription>}
        </EmptyHeader>
        {action && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    </div>
  );
}
