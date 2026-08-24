import { Injectable, NgZone, effect, inject, signal } from '@angular/core';
import type {
  ChannelMessage,
  PresenceEvent,
  SignallingClient,
  SignallingClientState,
} from '@metered-ca/realtime';

import type {
  LiveLocationMessage,
  LiveTrackingInvitation,
  LiveTrackingMessage,
  LiveTrackingRole,
  LiveTrackingStatus,
  RemoteParticipant,
} from '../models/live-tracking.model';
import {
  createLiveTrackingInvitation,
  decodeLiveTrackingInvitation,
  decryptLiveTrackingMessage,
  encryptLiveTrackingMessage,
} from '../utils/live-tracking-crypto.util';
import { LiveTrackingConfigService } from './live-tracking-config.service';
import type { UserLocation } from './user-location.service';
import { UserLocationService } from './user-location.service';

const HEARTBEAT_INTERVAL_MS = 15_000;
const MIN_LOCATION_INTERVAL_MS = 5_000;
const LOCATION_KEEPALIVE_MS = 30_000;
const MIN_LOCATION_DISTANCE_METERS = 10;

@Injectable({ providedIn: 'root' })
export class LiveTrackingService {
  private readonly userLocationService = inject(UserLocationService);
  private readonly configService = inject(LiveTrackingConfigService);
  private readonly ngZone = inject(NgZone);

  readonly $role = signal<LiveTrackingRole | null>(null);
  readonly $status = signal<LiveTrackingStatus>('idle');
  readonly $error = signal<string | null>(null);
  readonly $remoteParticipants = signal<RemoteParticipant[]>([]);
  readonly $expiresAt = signal<number | null>(null);
  readonly $invitationCode = signal<string | null>(null);

  private client: SignallingClient | null = null;
  private invitation: LiveTrackingInvitation | null = null;
  private localPeerId: string | null = null;
  private localName = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly latestMessageTimes = new Map<string, number>();
  private lastLocationPublishedAt = 0;
  private lastPublishedPosition: UserLocation | null = null;
  private isStopping = false;

  private readonly broadcastLocationEffect = effect(() => {
    const position = this.userLocationService.$position();
    if (position && this.$role() === 'seeker' && this.$status() === 'connected') {
      void this.publishLocation(position);
    }
  });

  private readonly syncLocationErrorEffect = effect(() => {
    const locationError = this.userLocationService.$error();
    if (this.$role() === 'seeker' && locationError) {
      this.$error.set(locationError);
      this.$status.set('error');
    }
  });

  async createSession(name: string): Promise<string | null> {
    this.stop();
    const { code, invitation } = createLiveTrackingInvitation();
    this.initializeSession('hider', name, code, invitation);

    if (!(await this.connectTransport())) {
      this.$invitationCode.set(null);
      return null;
    }
    this.$status.set('waiting');
    await this.publishSessionHeartbeat();
    this.heartbeatTimer = setInterval(
      () => void this.publishSessionHeartbeat(),
      HEARTBEAT_INTERVAL_MS,
    );
    return code;
  }

  async joinSession(code: string, name: string): Promise<boolean> {
    const invitation = decodeLiveTrackingInvitation(code);
    if (!invitation) {
      this.fail('This session code is invalid or has expired');
      return false;
    }

    this.stop();
    this.initializeSession('seeker', name, code.trim(), invitation);
    if (!(await this.connectTransport())) {
      return false;
    }
    this.$status.set('waiting');
    await this.publishMessage({ type: 'hello', name: this.localName, sentAt: Date.now() });
    return true;
  }

  async reconnect(): Promise<void> {
    if (this.$role() !== 'seeker' || !this.$invitationCode()) {
      return;
    }
    if (this.client?.state === 'reconnecting' || this.client?.state === 'connecting') {
      return;
    }

    const code = this.$invitationCode();
    const name = this.localName;
    if (code) {
      await this.joinSession(code, name);
    }
  }

  stop(): void {
    void this.broadcastLocationEffect;
    void this.syncLocationErrorEffect;
    this.isStopping = true;
    this.userLocationService.stop('live-tracking');
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.client) {
      void this.client.close();
      this.client = null;
    }
    this.invitation = null;
    this.localPeerId = null;
    this.localName = '';
    this.latestMessageTimes.clear();
    this.lastLocationPublishedAt = 0;
    this.lastPublishedPosition = null;
    this.$role.set(null);
    this.$status.set('idle');
    this.$error.set(null);
    this.$remoteParticipants.set([]);
    this.$expiresAt.set(null);
    this.$invitationCode.set(null);
    this.isStopping = false;
  }

  private initializeSession(
    role: LiveTrackingRole,
    name: string,
    code: string,
    invitation: LiveTrackingInvitation,
  ): void {
    this.$role.set(role);
    this.$status.set('preparing');
    this.$error.set(null);
    this.$invitationCode.set(code);
    this.$expiresAt.set(invitation.expiresAt);
    this.invitation = invitation;
    this.localName = cleanName(name, role === 'hider' ? 'Hider' : 'Seeker');
    this.expiryTimer = setTimeout(
      () => this.stop(),
      Math.max(0, invitation.expiresAt - Date.now()),
    );
  }

  private async connectTransport(): Promise<boolean> {
    const invitation = this.invitation;
    if (!invitation) {
      return false;
    }

    try {
      const [apiKey, { SignallingClient }] = await Promise.all([
        this.configService.loadApiKey(),
        import('@metered-ca/realtime'),
      ]);
      if (!this.invitation || this.invitation.channel !== invitation.channel) {
        return false;
      }

      const client = new SignallingClient({
        apiKey,
        autoResubscribe: true,
        reconnect: { maxAttempts: Infinity },
      });
      this.client = client;
      this.configureClientEvents(client, invitation.channel);
      await client.connect();
      await client.subscribe(invitation.channel);
      return this.client === client;
    } catch (error) {
      if (!this.invitation || this.invitation.channel !== invitation.channel) {
        return false;
      }
      this.client = null;
      this.fail(
        error instanceof Error && error.message === 'Live tracking is not configured'
          ? 'Live tracking needs a Metered publishable key in live-tracking-config.json'
          : 'Could not connect to the managed location relay. Try again.',
      );
      return false;
    }
  }

  private configureClientEvents(client: SignallingClient, channel: string): void {
    client.on('connected', ({ peerId, isReconnect }) => {
      this.ngZone.run(() => {
        if (this.client !== client) {
          return;
        }
        this.localPeerId = peerId;
        this.$error.set(null);
        if (isReconnect) {
          this.$status.set(this.$role() === 'hider' ? 'waiting' : 'connecting');
          setTimeout(() => void this.announceAfterReconnect(client), 500);
        }
      });
    });
    client.on('state-change', ({ to }) => {
      this.ngZone.run(() => this.syncTransportState(client, to));
    });
    client.on('message', (event) => {
      this.ngZone.run(() => void this.receiveMessage(client, channel, event));
    });
    client.on('presence', (event) => {
      this.ngZone.run(() => this.receivePresence(client, channel, event));
    });
    client.on('server-error', ({ code }) => {
      this.ngZone.run(() => {
        if (this.client === client && code === 'over_message_quota') {
          this.fail('The free live-tracking message limit has been reached');
        }
      });
    });
    client.on('disconnected', ({ willReconnect }) => {
      this.ngZone.run(() => {
        if (this.client === client && !this.isStopping) {
          this.$status.set(willReconnect ? 'reconnecting' : 'error');
          if (!willReconnect) {
            this.userLocationService.stop('live-tracking');
            this.$error.set('The managed relay disconnected. Use Retry to reconnect.');
          }
        }
      });
    });
  }

  private syncTransportState(client: SignallingClient, state: SignallingClientState): void {
    if (this.client !== client || this.isStopping) {
      return;
    }
    if (state === 'reconnecting') {
      this.$status.set('reconnecting');
    } else if (state === 'closed') {
      this.$status.set('error');
    }
  }

  private async announceAfterReconnect(client: SignallingClient): Promise<void> {
    if (this.client !== client) {
      return;
    }
    if (this.$role() === 'hider') {
      await this.publishSessionHeartbeat();
    } else if (this.$role() === 'seeker') {
      await this.publishMessage({ type: 'hello', name: this.localName, sentAt: Date.now() });
    }
  }

  private async receiveMessage(
    client: SignallingClient,
    channel: string,
    event: ChannelMessage,
  ): Promise<void> {
    if (
      this.client !== client ||
      event.channel !== channel ||
      event.from === this.localPeerId ||
      !this.invitation
    ) {
      return;
    }

    const message = await decryptLiveTrackingMessage(this.invitation.key, event.data);
    if (!message || this.client !== client) {
      return;
    }
    const replayKey = `${event.from}:${message.type}`;
    const previousTime = this.latestMessageTimes.get(replayKey) ?? 0;
    if (message.sentAt <= previousTime || Math.abs(Date.now() - message.sentAt) > 120_000) {
      return;
    }
    this.latestMessageTimes.set(replayKey, message.sentAt);

    if (this.$role() === 'hider') {
      this.receiveHiderMessage(event.from, message);
    } else if (this.$role() === 'seeker' && message.type === 'session') {
      this.receiveSessionHeartbeat(message);
    }
  }

  private receiveHiderMessage(senderId: string, message: LiveTrackingMessage): void {
    if (message.type === 'hello') {
      this.upsertParticipant({
        id: senderId,
        name: message.name,
        position: null,
        lastSeen: message.sentAt,
        connectionState: 'connected',
      });
      this.$status.set('connected');
      void this.publishSessionHeartbeat();
    } else if (message.type === 'location') {
      const existing = this.$remoteParticipants().find((participant) => participant.id === senderId);
      this.upsertParticipant({
        id: senderId,
        name: message.name,
        position: message.position,
        lastSeen: message.sentAt,
        connectionState: existing?.connectionState ?? 'connected',
      });
      this.$status.set('connected');
    }
  }

  private receiveSessionHeartbeat(message: Extract<LiveTrackingMessage, { type: 'session' }>): void {
    if (!this.invitation || message.expiresAt !== this.invitation.expiresAt) {
      return;
    }
    this.$error.set(null);
    this.$status.set('connected');
    this.userLocationService.start('live-tracking');
    const position = this.userLocationService.$position();
    if (position) {
      void this.publishLocation(position, true);
    }
  }

  private receivePresence(client: SignallingClient, channel: string, event: PresenceEvent): void {
    if (this.client !== client || event.channel !== channel || this.$role() !== 'hider') {
      return;
    }
    const leftIds = new Set(event.left.map((participant) => participant.peerId));
    if (leftIds.size === 0) {
      return;
    }
    this.$remoteParticipants.update((participants) =>
      participants.filter((participant) => !leftIds.has(participant.id)),
    );
    if (this.$remoteParticipants().length === 0) {
      this.$status.set('waiting');
    }
  }

  private async publishSessionHeartbeat(): Promise<void> {
    if (this.$role() !== 'hider' || !this.invitation) {
      return;
    }
    await this.publishMessage({
      type: 'session',
      expiresAt: this.invitation.expiresAt,
      sentAt: Date.now(),
    });
  }

  private async publishLocation(position: UserLocation, force = false): Promise<void> {
    const now = Date.now();
    if (!force && !this.shouldPublishLocation(position, now)) {
      return;
    }
    this.lastLocationPublishedAt = now;
    this.lastPublishedPosition = position;
    const message: LiveLocationMessage = {
      type: 'location',
      name: this.localName,
      position,
      sentAt: now,
    };
    await this.publishMessage(message);
  }

  private shouldPublishLocation(position: UserLocation, now: number): boolean {
    if (now - this.lastLocationPublishedAt < MIN_LOCATION_INTERVAL_MS) {
      return false;
    }
    return (
      !this.lastPublishedPosition ||
      now - this.lastLocationPublishedAt >= LOCATION_KEEPALIVE_MS ||
      distanceMeters(this.lastPublishedPosition, position) >= MIN_LOCATION_DISTANCE_METERS
    );
  }

  private async publishMessage(message: LiveTrackingMessage): Promise<void> {
    const client = this.client;
    const invitation = this.invitation;
    if (!client || client.state !== 'connected' || !invitation) {
      return;
    }
    try {
      const encrypted = await encryptLiveTrackingMessage(invitation.key, message);
      if (this.client === client && client.state === 'connected') {
        await client.publish(invitation.channel, encrypted);
      }
    } catch {
      if (this.client === client && !this.isStopping) {
        this.$status.set('error');
        this.$error.set('A location update could not be relayed. Use Retry to reconnect.');
      }
    }
  }

  private upsertParticipant(participant: RemoteParticipant): void {
    this.$remoteParticipants.update((participants) => [
      ...participants.filter((candidate) => candidate.id !== participant.id),
      participant,
    ]);
  }

  private fail(message: string): void {
    this.$error.set(message);
    this.$status.set('error');
  }
}

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, 80) || fallback;
}

function distanceMeters(first: UserLocation, second: UserLocation): number {
  const latitudeDelta = ((second.lat - first.lat) * Math.PI) / 180;
  const longitudeDelta = ((second.lng - first.lng) * Math.PI) / 180;
  const firstLatitude = (first.lat * Math.PI) / 180;
  const secondLatitude = (second.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
