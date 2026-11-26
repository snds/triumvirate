// The morning alert, browser side: works out whether this device can get it, and turns it on or off.
// iPhone rules (iOS 16.4+): only the app added to the Home Screen can receive alerts, and the
// permission prompt must come straight from a tap, so nothing is awaited before asking.

export type AlertState =
  | { kind: 'loading' }
  /** iPhone/iPad in a Safari tab: alerts need the Home Screen app. */
  | { kind: 'install' }
  /** No service worker or push here (an old browser, or the dev server). */
  | { kind: 'unsupported'; reason: string }
  /** The server has alerts off. */
  | { kind: 'server-off' }
  | { kind: 'denied' }
  | { kind: 'off'; publicKey: string; digestHour: number | null }
  | { kind: 'on'; publicKey: string; digestHour: number | null; endpoint: string };

const isAppleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** The registered service worker, without waiting forever when there isn't one (as in dev). */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  return (await navigator.serviceWorker.getRegistration()) ?? undefined;
}

interface Status { enabled: boolean; publicKey?: string; subscribed?: boolean; digestHour?: number | null }

export async function alertState(): Promise<AlertState> {
  const push = 'PushManager' in window && 'Notification' in window;
  if (!push && isAppleMobile() && !isInstalled()) return { kind: 'install' };
  if (!push) return { kind: 'unsupported', reason: 'This browser can\'t show alerts.' };
  const reg = await registration();
  if (!reg) return { kind: 'unsupported', reason: import.meta.env.DEV ? 'Alerts only work in the built app, not the dev server.' : 'The app is still setting up. Reopen it and try again.' };
  const sub = await reg.pushManager.getSubscription();
  const res = await fetch(`/api/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`);
  const s = (await res.json().catch(() => ({ enabled: false }))) as Status;
  if (!s.enabled || !s.publicKey) return { kind: 'server-off' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  const digestHour = s.digestHour ?? null;
  // A subscription the server doesn't know (say, after its data was reset) is re-sent quietly.
  if (sub && Notification.permission === 'granted') {
    if (!s.subscribed) await save(sub);
    return { kind: 'on', publicKey: s.publicKey, digestHour, endpoint: sub.endpoint };
  }
  return { kind: 'off', publicKey: s.publicKey, digestHour };
}

const device = () => {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Browser';
};

async function save(sub: PushSubscription) {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), device: device() }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't save it (${res.status}).`);
}

/** VAPID public keys arrive base64url; the push manager wants the raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Call straight from a tap. Asks permission, subscribes this device, and tells the server. */
export async function enableAlerts(publicKey: string): Promise<AlertState> {
  const permission = await Notification.requestPermission(); // first, while the tap still counts
  if (permission === 'denied') return { kind: 'denied' };
  if (permission !== 'granted') return alertState(); // dismissed: stays off
  const reg = await registration();
  if (!reg) return alertState();
  // Subscribing talks to the browser's push service (Apple's on iPhone); don't spin forever if it's unreachable.
  const sub = (await reg.pushManager.getSubscription()) ?? await Promise.race([
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }),
    new Promise<never>((_, fail) => setTimeout(() => fail(new Error('The push service didn\'t answer. Check your connection and try again.')), 20_000)),
  ]);
  await save(sub);
  return alertState();
}

export async function disableAlerts(): Promise<AlertState> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return alertState();
}

export async function sendTestAlert(endpoint: string): Promise<string | undefined> {
  const res = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
  if (res.ok) return undefined;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't send it (${res.status}).`;
}

/** Opening the digest clears its alert from Notification Center and the badge on the app icon. */
export async function clearDigestAlerts() {
  try {
    const reg = await registration();
    for (const n of (await reg?.getNotifications({ tag: 'digest' })) ?? []) n.close();
    await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
  } catch { /* nice to have */ }
}
