import { describe, expect, it } from 'vitest';

import {
  createLiveTrackingInvitation,
  decodeLiveTrackingInvitation,
  decryptLiveTrackingMessage,
  encryptLiveTrackingMessage,
} from './live-tracking-crypto.util';

describe('live tracking crypto', () => {
  it('round trips an invitation and Unicode encrypted message', async () => {
    const now = 2_000_000_000_000;
    const { code, invitation } = createLiveTrackingInvitation(now);
    const decoded = decodeLiveTrackingInvitation(code, now);
    expect(decoded).toEqual(invitation);

    const encrypted = await encryptLiveTrackingMessage(invitation.key, {
      type: 'location',
      name: 'Zoë 🚂',
      position: { lat: 52.37, lng: 4.89, accuracyMeters: 8 },
      sentAt: now,
    });

    await expect(decryptLiveTrackingMessage(invitation.key, encrypted)).resolves.toEqual({
      type: 'location',
      name: 'Zoë 🚂',
      position: { lat: 52.37, lng: 4.89, accuracyMeters: 8 },
      sentAt: now,
    });
  });

  it('rejects expired invitations, tampering, and the wrong key', async () => {
    const now = 2_000_000_000_000;
    const first = createLiveTrackingInvitation(now);
    const second = createLiveTrackingInvitation(now);
    expect(decodeLiveTrackingInvitation(first.code, now + 6 * 60 * 60 * 1000 + 1)).toBeNull();

    const encrypted = await encryptLiveTrackingMessage(first.invitation.key, {
      type: 'hello',
      name: 'Seeker',
      sentAt: now,
    });
    await expect(decryptLiveTrackingMessage(second.invitation.key, encrypted)).resolves.toBeNull();
    await expect(
      decryptLiveTrackingMessage(first.invitation.key, {
        ...encrypted,
        ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
      }),
    ).resolves.toBeNull();
  });
});
