// Round trip: what web-push encrypts for a device, the device's own keys can read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import webpush from 'web-push';

test('payload is encrypted so only the subscribing device can read it', () => {
  const require = createRequire(import.meta.resolve('web-push'));
  const ece = require('http_ece') as { decrypt: (buf: Buffer, o: object) => Buffer };
  const device = createECDH('prime256v1');
  device.generateKeys();
  const auth = randomBytes(16);
  const vapid = webpush.generateVAPIDKeys();
  const sub = { endpoint: 'https://web.push.apple.com/test', keys: { p256dh: device.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const msg = JSON.stringify({ title: 'New god roll: Fatebringer', body: '2 new items', tag: 'digest', url: '/?open=digest' });
  const req = webpush.generateRequestDetails(sub, msg, { vapidDetails: { subject: 'mailto:me@example.com', ...vapid }, TTL: 60 });
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.match(String(req.headers.Authorization), /^vapid t=.+, k=/);
  const plain = ece.decrypt(req.body as Buffer, { version: 'aes128gcm', privateKey: device, authSecret: auth.toString('base64url') });
  assert.equal(plain.toString(), msg);
});
