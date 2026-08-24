import type {
  EncryptedLiveTrackingMessage,
  LiveTrackingInvitation,
  LiveTrackingMessage,
} from '../models/live-tracking.model';

const INVITATION_PREFIX = 'JLM2.';
const INVITATION_VERSION = 2;
const ENCRYPTION_CONTEXT = new TextEncoder().encode('jetlag-live-location-v2');
const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;

interface SerializedInvitation {
  version: typeof INVITATION_VERSION;
  channel: string;
  key: string;
  expiresAt: number;
}

export function createLiveTrackingInvitation(now = Date.now()): {
  code: string;
  invitation: LiveTrackingInvitation;
} {
  const channel = `jetlag-live-${toBase64Url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const key = crypto.getRandomValues(new Uint8Array(32));
  const expiresAt = now + SESSION_DURATION_MS;
  const serialized: SerializedInvitation = {
    version: INVITATION_VERSION,
    channel,
    key: toBase64Url(key),
    expiresAt,
  };
  return {
    code: `${INVITATION_PREFIX}${toBase64Url(new TextEncoder().encode(JSON.stringify(serialized)))}`,
    invitation: { channel, key, expiresAt },
  };
}

export function decodeLiveTrackingInvitation(
  code: string,
  now = Date.now(),
): LiveTrackingInvitation | null {
  const normalized = code.trim();
  if (!normalized.startsWith(INVITATION_PREFIX) || normalized.length > 1000) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64Url(normalized.slice(INVITATION_PREFIX.length))),
    );
    if (!isSerializedInvitation(value, now)) {
      return null;
    }
    const key = fromBase64Url(value.key);
    return key.length === 32
      ? { channel: value.channel, key: key as Uint8Array<ArrayBuffer>, expiresAt: value.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export async function encryptLiveTrackingMessage(
  keyBytes: Uint8Array<ArrayBuffer>,
  message: LiveTrackingMessage,
): Promise<EncryptedLiveTrackingMessage> {
  const key = await importKey(keyBytes, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(message));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ENCRYPTION_CONTEXT },
    key,
    plaintext,
  );
  return {
    version: 1,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptLiveTrackingMessage(
  keyBytes: Uint8Array<ArrayBuffer>,
  value: unknown,
): Promise<LiveTrackingMessage | null> {
  if (!isEncryptedMessage(value)) {
    return null;
  }

  try {
    const iv = fromBase64Url(value.iv);
    if (iv.length !== 12) {
      return null;
    }
    const key = await importKey(keyBytes, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: ENCRYPTION_CONTEXT },
      key,
      fromBase64Url(value.ciphertext),
    );
    const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return isLiveTrackingMessage(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function importKey(
  keyBytes: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, usages);
}

function isSerializedInvitation(value: unknown, now: number): value is SerializedInvitation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value['version'] === INVITATION_VERSION &&
    typeof value['channel'] === 'string' &&
    /^jetlag-live-[A-Za-z0-9_-]{20,30}$/.test(value['channel']) &&
    typeof value['key'] === 'string' &&
    value['key'].length >= 40 &&
    value['key'].length <= 50 &&
    typeof value['expiresAt'] === 'number' &&
    Number.isFinite(value['expiresAt']) &&
    value['expiresAt'] > now &&
    value['expiresAt'] <= now + SESSION_DURATION_MS + 60_000
  );
}

function isEncryptedMessage(value: unknown): value is EncryptedLiveTrackingMessage {
  return (
    isRecord(value) &&
    value['version'] === 1 &&
    typeof value['iv'] === 'string' &&
    value['iv'].length <= 32 &&
    typeof value['ciphertext'] === 'string' &&
    value['ciphertext'].length > 0 &&
    value['ciphertext'].length <= 4096
  );
}

function isLiveTrackingMessage(value: unknown): value is LiveTrackingMessage {
  if (!isRecord(value) || !isTimestamp(value['sentAt'])) {
    return false;
  }
  if (value['type'] === 'session') {
    return isTimestamp(value['expiresAt']);
  }
  if (value['type'] === 'hello') {
    return isName(value['name']);
  }
  if (value['type'] !== 'location' || !isName(value['name']) || !isRecord(value['position'])) {
    return false;
  }
  const position = value['position'];
  return (
    isFiniteRange(position['lat'], -90, 90) &&
    isFiniteRange(position['lng'], -180, 180) &&
    isFiniteRange(position['accuracyMeters'], 0, 1_000_000)
  );
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80;
}

function isTimestamp(value: unknown): value is number {
  return isFiniteRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
