import type { WebClient } from '@slack/web-api';
import { logger } from '../logger';

interface Cached<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const NEG_TTL_MS = 5 * 60 * 1000;

const userCache = new Map<string, Cached<UserIdentity>>();
const channelCache = new Map<string, Cached<ChannelIdentity>>();

export interface UserIdentity {
  id: string;
  displayName: string;
  email: string | null;
}

export interface ChannelIdentity {
  id: string;
  name: string;
  isDm: boolean;
}

export interface SlackIdentity {
  user: UserIdentity;
  channel: ChannelIdentity;
}

function fresh<T>(c: Cached<T> | undefined): c is Cached<T> {
  return !!c && c.expiresAt > Date.now();
}

export async function resolveUser(
  client: WebClient,
  userId: string,
): Promise<UserIdentity> {
  const cached = userCache.get(userId);
  if (fresh(cached)) return cached.value;

  try {
    const res = await client.users.info({ user: userId });
    const u = res.user;
    const displayName =
      u?.profile?.display_name?.trim() ||
      u?.profile?.real_name?.trim() ||
      u?.name ||
      userId;
    const value: UserIdentity = {
      id: userId,
      displayName,
      email: u?.profile?.email ?? null,
    };
    userCache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err: String(err), userId }, 'users.info failed — using id');
    const fallback: UserIdentity = { id: userId, displayName: userId, email: null };
    userCache.set(userId, { value: fallback, expiresAt: Date.now() + NEG_TTL_MS });
    return fallback;
  }
}

export async function resolveChannel(
  client: WebClient,
  channelId: string,
  hintIsDm: boolean,
): Promise<ChannelIdentity> {
  if (hintIsDm) return { id: channelId, name: 'DM', isDm: true };

  const cached = channelCache.get(channelId);
  if (fresh(cached)) return cached.value;

  try {
    const res = await client.conversations.info({ channel: channelId });
    const ch = res.channel as { name?: string; is_im?: boolean } | undefined;
    const isDm = !!ch?.is_im;
    const name = isDm ? 'DM' : ch?.name ? `#${ch.name}` : channelId;
    const value: ChannelIdentity = { id: channelId, name, isDm };
    channelCache.set(channelId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    logger.warn(
      { err: String(err), channelId },
      'conversations.info failed — using id',
    );
    const fallback: ChannelIdentity = {
      id: channelId,
      name: channelId,
      isDm: false,
    };
    channelCache.set(channelId, { value: fallback, expiresAt: Date.now() + NEG_TTL_MS });
    return fallback;
  }
}

export async function resolveIdentity(
  client: WebClient,
  userId: string,
  channelId: string,
  hintIsDm: boolean,
): Promise<SlackIdentity> {
  const [user, channel] = await Promise.all([
    resolveUser(client, userId),
    resolveChannel(client, channelId, hintIsDm),
  ]);
  return { user, channel };
}

export function formatSlackMeta(
  identity: SlackIdentity,
  threadTs: string,
): string {
  const { user, channel } = identity;
  const senderLine = user.email
    ? `${user.displayName} (${user.id}, ${user.email})`
    : `${user.displayName} (${user.id})`;
  return [
    `<slack-context>`,
    `  sender: ${senderLine}`,
    `  channel: ${channel.name} (${channel.id})`,
    `  thread_ts: ${threadTs}`,
    `  received_at: ${new Date().toISOString()}`,
    `</slack-context>`,
  ].join('\n');
}
