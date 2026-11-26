// Web Push: the morning alert on your phone when the daily digest is ready.
// Each device that turns alerts on hands us a "subscription" (an address at Apple's, Google's, or
// Mozilla's push service plus two keys). We keep those in .data/push.json and post to them.
// Messages are signed with a VAPID key pair, so the push services know they come from this server.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpush, { type PushSubscription } from 'web-push';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: address the push services can contact. Apple rejects localhost. */
  subject: string;
}

export interface SavedSubscription extends PushSubscription {
  /** Rough device label from the browser, so the list makes sense if you ever read the file. */
  device?: string;
  createdAt: string;
}

/** What the app shows in a notification; the service worker reads this. */
export interface PushMessage {
  title: string;
  body: string;
  /** Collapses repeats: a new digest alert replaces yesterday's instead of stacking. */
  tag?: string;
  /** Where tapping the alert goes. */
  url?: string;
}

/**
 * VAPID keys: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set, otherwise made once and kept in
 * .data/vapid.json. Changing keys signs every device out of alerts, so the saved pair is reused.
 */
export async function loadPushConfig(dataDir: string, env: NodeJS.ProcessEnv): Promise<PushConfig> {
  // The hosted copy already lists your email in ALLOWED_EMAILS, so that's the contact by default.
  const email = env.ALLOWED_EMAILS?.split(',')[0]?.trim();
  const subject = env.VAPID_SUBJECT || (email ? `mailto:${email}` : 'mailto:triumvirate@example.com');
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  const file = join(dataDir, 'vapid.json');
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as { publicKey: string; privateKey: string };
    if (saved.publicKey && saved.privateKey) return { ...saved, subject };
  } catch { /* first run */ }
  const keys = webpush.generateVAPIDKeys();
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, JSON.stringify(keys), { mode: 0o600 });
  return { ...keys, subject };
}

const validSubscription = (s: unknown): s is PushSubscription => {
  const x = s as PushSubscription | undefined;
  return !!x && typeof x.endpoint === 'string' && /^https:\/\//.test(x.endpoint) && x.endpoint.length < 2000
    && typeof x.keys?.p256dh === 'string' && typeof x.keys?.auth === 'string';
};

/** Sends one message; returns true when the push service says the subscription is gone for good. */
export type Sender = (sub: PushSubscription, payload: string, cfg: PushConfig) => Promise<{ gone: boolean }>;

const webPushSender: Sender = async (sub, payload, cfg) => {
  try {
    await webpush.sendNotification(sub, payload, {
      vapidDetails: cfg,
      TTL: 12 * 3600, // a phone that's off all morning still gets it by lunch, not tomorrow
      urgency: 'normal',
    });
    return { gone: false };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404/410: the device unsubscribed or the app was removed. Anything else is worth a retry tomorrow.
    if (status === 404 || status === 410) return { gone: true };
    throw e;
  }
};

export function createPush(dataDir: string, config: () => Promise<PushConfig>, send: Sender = webPushSender) {
  const file = join(dataDir, 'push.json');
  const read = async (): Promise<SavedSubscription[]> => {
    try { return JSON.parse(await readFile(file, 'utf8')) as SavedSubscription[]; } catch { return []; }
  };
  const write = async (list: SavedSubscription[]) => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(list, null, 1), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  return {
    publicKey: async () => (await config()).publicKey,
    validSubscription,
    async has(endpoint: string) { return (await read()).some((s) => s.endpoint === endpoint); },
    count: async () => (await read()).length,
    /** Adds or refreshes a device (same endpoint replaces the old entry). */
    add: (sub: PushSubscription, device?: string) => locked(async () => {
      const list = (await read()).filter((s) => s.endpoint !== sub.endpoint);
      list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ...(device ? { device: device.slice(0, 120) } : {}), createdAt: new Date().toISOString() });
      await write(list);
    }),
    remove: (endpoint: string) => locked(async () => { await write((await read()).filter((s) => s.endpoint !== endpoint)); }),
    /** Sends to every device (or one), dropping any the push service says are gone. */
    async notify(msg: PushMessage, only?: string) {
      const cfg = await config();
      const list = (await read()).filter((s) => !only || s.endpoint === only);
      const payload = JSON.stringify(msg);
      const gone: string[] = [];
      let sent = 0;
      await Promise.all(list.map(async (s) => {
        try {
          if ((await send(s, payload, cfg)).gone) gone.push(s.endpoint); else sent++;
        } catch (e) { console.error(`Push to ${s.device ?? 'a device'} failed:`, e instanceof Error ? e.message : e); }
      }));
      if (gone.length) await locked(async () => { await write((await read()).filter((s) => !gone.includes(s.endpoint))); });
      return { sent, removed: gone.length, failed: list.length - sent - gone.length };
    },
  };
}
export type Push = ReturnType<typeof createPush>;
