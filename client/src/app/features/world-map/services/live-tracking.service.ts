import { Injectable, NgZone, effect, inject, signal } from '@angular/core';
import type { DataConnection, Peer, PeerError, PeerErrorType, PeerOptions } from 'peerjs';

import type {
  LiveLocationMessage,
  LiveTrackingMessage,
  LiveTrackingRole,
  LiveTrackingStatus,
  RemoteParticipant,
} from '../models/live-tracking.model';
import { UserLocationService } from './user-location.service';

const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;
const SIGNALING_TIMEOUT_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 20_000;
const INVITATION_PREFIX = 'JLM1.';
const CONNECTION_LABEL = 'jetlag-live-location-v1';
const PEER_OPTIONS: PeerOptions = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 0,
};

interface ConnectionMetadata {
  protocol: typeof CONNECTION_LABEL;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class LiveTrackingService {
  private readonly userLocationService = inject(UserLocationService);
  private readonly ngZone = inject(NgZone);

  readonly $role = signal<LiveTrackingRole | null>(null);
  readonly $status = signal<LiveTrackingStatus>('idle');
  readonly $error = signal<string | null>(null);
  readonly $remoteParticipants = signal<RemoteParticipant[]>([]);
  readonly $expiresAt = signal<number | null>(null);
  readonly $invitationCode = signal<string | null>(null);

  private readonly connections = new Map<string, DataConnection>();
  private peer: Peer | null = null;
  private hiderPeerId: string | null = null;
  private localName = '';
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private isStopping = false;

  private readonly broadcastLocationEffect = effect(() => {
    const position = this.userLocationService.$position();
    if (!position || this.$role() !== 'seeker') {
      return;
    }
    this.sendToOpenConnections({ type: 'location', position, sentAt: Date.now() });
  });

  private readonly syncLocationErrorEffect = effect(() => {
    const locationError = this.userLocationService.$error();
    if (this.$role() === 'seeker' && locationError) {
      this.$error.set(locationError);
      this.$status.set('error');
    }
  });

  async createSession(name: string): Promise<string | null> {
    if (!this.isWebRtcSupported()) {
      this.fail('Live tracking is not supported by this browser');
      return null;
    }

    this.stop();
    this.$role.set('hider');
    this.$status.set('preparing');
    this.localName = cleanName(name, 'Hider');
    this.setExpiry(Date.now() + SESSION_DURATION_MS);

    try {
      const peer = await this.createPeer();
      if (this.$role() !== 'hider') {
        peer.destroy();
        return null;
      }
      this.peer = peer;
      this.configurePeerEvents(peer);
      peer.on('connection', (connection) => {
        this.ngZone.run(() => this.acceptIncomingConnection(connection));
      });
      const peerId = await this.waitForPeerOpen(peer);
      if (this.peer !== peer) {
        return null;
      }

      const invitationCode = encodeInvitation(peerId);
      this.$invitationCode.set(invitationCode);
      this.$status.set('waiting');
      return invitationCode;
    } catch {
      if (this.$role() !== 'hider') {
        return null;
      }
      this.stop();
      this.fail('Could not reach the free signaling service. Try again.');
      return null;
    }
  }

  async joinSession(code: string, name: string): Promise<boolean> {
    const hiderPeerId = decodeInvitation(code);
    if (!hiderPeerId) {
      this.fail('This session code is invalid');
      return false;
    }
    if (!this.isWebRtcSupported()) {
      this.fail('Live tracking is not supported by this browser');
      return false;
    }

    this.stop();
    this.$role.set('seeker');
    this.$status.set('preparing');
    this.localName = cleanName(name, 'Seeker');
    this.hiderPeerId = hiderPeerId;
    this.$invitationCode.set(encodeInvitation(hiderPeerId));
    this.setExpiry(Date.now() + SESSION_DURATION_MS);

    try {
      const peer = await this.createPeer();
      if (this.$role() !== 'seeker') {
        peer.destroy();
        return false;
      }
      this.peer = peer;
      this.configurePeerEvents(peer);
      await this.waitForPeerOpen(peer);
      if (this.peer !== peer) {
        return false;
      }
      return true;
    } catch {
      if (this.$role() !== 'seeker') {
        return false;
      }
      this.stop();
      this.fail('Could not reach the free signaling service. Try again.');
      return false;
    }
  }

  async reconnect(): Promise<void> {
    if (this.$role() !== 'seeker' || !this.hiderPeerId) {
      return;
    }

    this.$error.set(null);
    this.$status.set('connecting');
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) {
        this.peer.reconnect();
        return;
      }
      this.connectToHider(this.peer, this.hiderPeerId);
      return;
    }

    const invitation = encodeInvitation(this.hiderPeerId);
    const name = this.localName;
    await this.joinSession(invitation, name);
  }

  stop(): void {
    void this.broadcastLocationEffect;
    void this.syncLocationErrorEffect;
    this.isStopping = true;
    this.userLocationService.stop('live-tracking');
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.hiderPeerId = null;
    this.localName = '';
    this.$role.set(null);
    this.$status.set('idle');
    this.$error.set(null);
    this.$remoteParticipants.set([]);
    this.$expiresAt.set(null);
    this.$invitationCode.set(null);
    this.isStopping = false;
  }

  private async createPeer(): Promise<Peer> {
    const { Peer } = await import('peerjs');
    return new Peer(PEER_OPTIONS);
  }

  private configurePeerEvents(peer: Peer): void {
    peer.on('open', () => {
      this.ngZone.run(() => {
        if (this.peer !== peer) {
          return;
        }
        if ([...this.connections.values()].some((connection) => connection.open)) {
          this.$error.set(null);
          this.$status.set('connected');
        } else if (this.$role() === 'seeker' && this.hiderPeerId) {
          this.connectToHider(peer, this.hiderPeerId);
        } else if (this.$role() === 'hider') {
          this.$status.set('waiting');
        }
      });
    });
    peer.on('disconnected', () => {
      this.ngZone.run(() => {
        if (!this.isStopping && this.peer === peer && !peer.destroyed) {
          peer.reconnect();
        }
      });
    });
    peer.on('error', (error) => {
      this.ngZone.run(() => this.handlePeerError(peer, error));
    });
  }

  private waitForPeerOpen(peer: Peer): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Signaling timed out'));
        }
      }, SIGNALING_TIMEOUT_MS);
      peer.on('open', (peerId) => {
        this.ngZone.run(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(peerId);
          }
        });
      });
      peer.on('error', (error) => {
        this.ngZone.run(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
      peer.on('close', () => {
        this.ngZone.run(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error('Signaling closed'));
          }
        });
      });
    });
  }

  private acceptIncomingConnection(connection: DataConnection): void {
    const metadata = parseConnectionMetadata(connection.metadata);
    if (
      this.$role() !== 'hider' ||
      connection.label !== CONNECTION_LABEL ||
      !metadata ||
      (this.$expiresAt() ?? 0) <= Date.now()
    ) {
      connection.close();
      return;
    }
    this.configureHiderConnection(connection, metadata.name);
  }

  private connectToHider(peer: Peer, hiderPeerId: string): void {
    const existing = this.connections.get(hiderPeerId);
    if (existing && !existing.open) {
      existing.close();
    } else if (existing?.open) {
      return;
    }

    this.$status.set('connecting');
    const metadata: ConnectionMetadata = { protocol: CONNECTION_LABEL, name: this.localName };
    const connection = peer.connect(hiderPeerId, {
      label: CONNECTION_LABEL,
      metadata,
      serialization: 'json',
      reliable: true,
    });
    this.connections.set(hiderPeerId, connection);
    this.configureSeekerConnection(connection);
  }

  private configureHiderConnection(connection: DataConnection, name: string): void {
    const participantId = connection.peer;
    const previous = this.connections.get(participantId);
    if (previous && previous !== connection) {
      previous.close();
    }
    this.connections.set(participantId, connection);

    connection.on('open', () => {
      this.ngZone.run(() => {
        if (this.connections.get(participantId) !== connection) {
          return;
        }
        this.upsertParticipant({
          id: participantId,
          name,
          position: null,
          lastSeen: null,
          connectionState: 'connected',
        });
        connection.send({
          type: 'session',
          expiresAt: this.$expiresAt() ?? Date.now() + SESSION_DURATION_MS,
        } satisfies LiveTrackingMessage);
        this.$status.set('connected');
      });
    });
    connection.on('data', (data) => {
      this.ngZone.run(() => this.receiveHiderMessage(participantId, data));
    });
    connection.on('close', () => {
      this.ngZone.run(() => this.removeConnection(participantId, connection));
    });
    connection.on('error', () => {
      this.ngZone.run(() => {
        this.updateParticipant(participantId, { connectionState: 'failed' });
      });
    });
  }

  private configureSeekerConnection(connection: DataConnection): void {
    const hiderPeerId = connection.peer;
    let didTimeOut = false;
    const timeout = setTimeout(() => {
      this.ngZone.run(() => {
        if (this.connections.get(hiderPeerId) !== connection || connection.open) {
          return;
        }
        didTimeOut = true;
        connection.close();
        this.connections.delete(hiderPeerId);
        this.$status.set('error');
        this.$error.set('Connection timed out. Retry or switch networks.');
      });
    }, CONNECTION_TIMEOUT_MS);
    connection.on('open', () => {
      this.ngZone.run(() => {
        if (this.connections.get(hiderPeerId) !== connection) {
          return;
        }
        clearTimeout(timeout);
        this.$error.set(null);
        this.$status.set('connected');
        this.userLocationService.start('live-tracking');
        this.broadcastCurrentLocation();
      });
    });
    connection.on('data', (data) => {
      this.ngZone.run(() => this.receiveSeekerMessage(data));
    });
    connection.on('close', () => {
      this.ngZone.run(() => {
        clearTimeout(timeout);
        if (didTimeOut) {
          return;
        }
        if (this.connections.get(hiderPeerId) !== connection) {
          return;
        }
        this.connections.delete(hiderPeerId);
        this.userLocationService.stop('live-tracking');
        if (!this.isStopping) {
          this.$status.set('waiting');
          this.$error.set('Connection lost. Use Retry to reconnect.');
        }
      });
    });
    connection.on('error', () => {
      this.ngZone.run(() => {
        clearTimeout(timeout);
        if (!connection.open && !this.isStopping) {
          this.$status.set('error');
          this.$error.set('Could not open a direct connection. Retry or switch networks.');
        }
      });
    });
  }

  private receiveHiderMessage(participantId: string, value: unknown): void {
    if (!isLiveLocationMessage(value)) {
      return;
    }
    this.updateParticipant(participantId, { position: value.position, lastSeen: value.sentAt });
  }

  private receiveSeekerMessage(value: unknown): void {
    if (!isLiveSessionMessage(value)) {
      return;
    }
    this.setExpiry(Math.min(value.expiresAt, Date.now() + SESSION_DURATION_MS));
  }

  private broadcastCurrentLocation(): void {
    const position = this.userLocationService.$position();
    if (position) {
      this.sendToOpenConnections({ type: 'location', position, sentAt: Date.now() });
    }
  }

  private sendToOpenConnections(message: LiveTrackingMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.open) {
        connection.send(message);
      }
    }
  }

  private removeConnection(participantId: string, connection: DataConnection): void {
    if (this.connections.get(participantId) !== connection) {
      return;
    }
    this.connections.delete(participantId);
    this.$remoteParticipants.update((participants) =>
      participants.filter((participant) => participant.id !== participantId),
    );
    if (!this.isStopping && this.connections.size === 0) {
      this.$status.set('waiting');
    }
  }

  private handlePeerError(peer: Peer, error: PeerError<`${PeerErrorType}`>): void {
    if (this.isStopping || this.peer !== peer) {
      return;
    }

    if (error.type === 'peer-unavailable') {
      this.$status.set('error');
      this.$error.set('Session not found. Check the code or ask the hider for a new session.');
      return;
    }
    if (error.type === 'network' && [...this.connections.values()].some((connection) => connection.open)) {
      return;
    }
    this.$status.set('error');
    this.$error.set('The signaling service is unavailable. Retry in a moment.');
  }

  private upsertParticipant(participant: RemoteParticipant): void {
    this.$remoteParticipants.update((participants) => [
      ...participants.filter((candidate) => candidate.id !== participant.id),
      participant,
    ]);
  }

  private updateParticipant(participantId: string, patch: Partial<RemoteParticipant>): void {
    this.$remoteParticipants.update((participants) =>
      participants.map((participant) =>
        participant.id === participantId ? { ...participant, ...patch } : participant,
      ),
    );
  }

  private setExpiry(expiresAt: number): void {
    this.$expiresAt.set(expiresAt);
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
    }
    this.expiryTimer = setTimeout(() => this.stop(), Math.max(0, expiresAt - Date.now()));
  }

  private isWebRtcSupported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  private fail(message: string): void {
    this.$error.set(message);
    this.$status.set('error');
  }
}

function encodeInvitation(peerId: string): string {
  return `${INVITATION_PREFIX}${peerId}`;
}

function decodeInvitation(value: string): string | null {
  const normalized = value.trim();
  if (!normalized.startsWith(INVITATION_PREFIX)) {
    return null;
  }
  const peerId = normalized.slice(INVITATION_PREFIX.length);
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{8,98}[a-zA-Z0-9]$/.test(peerId) ? peerId : null;
}

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 80) || fallback;
}

function parseConnectionMetadata(value: unknown): ConnectionMetadata | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata['protocol'] !== CONNECTION_LABEL ||
    typeof metadata['name'] !== 'string' ||
    metadata['name'].length === 0 ||
    metadata['name'].length > 80
  ) {
    return null;
  }
  return { protocol: CONNECTION_LABEL, name: metadata['name'] };
}

function isLiveSessionMessage(value: unknown): value is Extract<LiveTrackingMessage, { type: 'session' }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    message['type'] === 'session' &&
    isFiniteRange(message['expiresAt'], Date.now() - 60_000, Date.now() + SESSION_DURATION_MS)
  );
}

function isLiveLocationMessage(value: unknown): value is LiveLocationMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  const position = message['position'];
  if (typeof position !== 'object' || position === null || Array.isArray(position)) {
    return false;
  }
  const coordinates = position as Record<string, unknown>;
  return (
    message['type'] === 'location' &&
    isFiniteRange(coordinates['lat'], -90, 90) &&
    isFiniteRange(coordinates['lng'], -180, 180) &&
    isFiniteRange(coordinates['accuracyMeters'], 0, 1_000_000) &&
    isFiniteRange(message['sentAt'], 0, Number.MAX_SAFE_INTEGER)
  );
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
