import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decodeLiveTrackingInvitation,
  encryptLiveTrackingMessage,
} from '../utils/live-tracking-crypto.util';
import { LiveTrackingConfigService } from './live-tracking-config.service';
import { LiveTrackingService } from './live-tracking.service';
import { UserLocationService } from './user-location.service';

type EventHandler = (payload: unknown) => void;

class FakeSignallingClient {
  static instances: FakeSignallingClient[] = [];

  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'idle';
  readonly published: Array<{ channel: string; data: unknown }> = [];
  readonly subscriptions: string[] = [];
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor() {
    FakeSignallingClient.instances.push(this);
  }

  on(event: string, handler: EventHandler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.emit('state-change', { from: 'idle', to: 'connecting' });
    this.state = 'connected';
    this.emit('connected', {
      peerId: `peer-${FakeSignallingClient.instances.length}`,
      serverTime: Date.now() / 1000,
      expiresAt: null,
      isReconnect: false,
      maxMessageSize: 65_536,
    });
    this.emit('state-change', { from: 'connecting', to: 'connected' });
  }

  async subscribe(channel: string): Promise<void> {
    this.subscriptions.push(channel);
  }

  async publish(channel: string, data: unknown): Promise<void> {
    this.published.push({ channel, data });
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

vi.mock('@metered-ca/realtime', () => ({ SignallingClient: FakeSignallingClient }));

describe('LiveTrackingService', () => {
  const locationService = {
    $position: signal(null),
    $error: signal(null),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const configService = { loadApiKey: vi.fn(async () => 'pk_live_test') };

  beforeEach(() => {
    FakeSignallingClient.instances = [];
    locationService.$position.set(null);
    locationService.$error.set(null);
    locationService.start.mockClear();
    locationService.stop.mockClear();
    configService.loadApiKey.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: UserLocationService, useValue: locationService },
        { provide: LiveTrackingConfigService, useValue: configService },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(LiveTrackingService).stop();
    vi.restoreAllMocks();
  });

  it('creates one encrypted reusable hider session', async () => {
    const service = TestBed.inject(LiveTrackingService);

    const code = await service.createSession('Hider');
    const client = FakeSignallingClient.instances[0];

    expect(code).toMatch(/^JLM2\./);
    expect(service.$role()).toBe('hider');
    expect(service.$status()).toBe('waiting');
    expect(client.subscriptions[0]).toMatch(/^jetlag-live-/);
    expect(client.published).toHaveLength(1);
    expect(client.published[0].data).not.toHaveProperty('type');
  });

  it('starts seeker location only after an encrypted hider heartbeat', async () => {
    const hiderService = TestBed.inject(LiveTrackingService);
    const code = await hiderService.createSession('Hider');
    if (!code) {
      throw new Error('Expected a session code');
    }
    hiderService.stop();

    const service = TestBed.inject(LiveTrackingService);
    await service.joinSession(code, 'Seeker');
    const client = FakeSignallingClient.instances.at(-1);
    const invitation = decodeLiveTrackingInvitation(code);
    if (!client || !invitation) {
      throw new Error('Expected a relay client and invitation');
    }
    expect(service.$status()).toBe('waiting');
    expect(locationService.start).not.toHaveBeenCalled();

    const heartbeat = await encryptLiveTrackingMessage(invitation.key, {
      type: 'session',
      expiresAt: invitation.expiresAt,
      sentAt: Date.now(),
    });
    client.emit('message', { channel: invitation.channel, from: 'hider', data: heartbeat });

    await vi.waitFor(() => expect(service.$status()).toBe('connected'));
    expect(locationService.start).toHaveBeenCalledWith('live-tracking');
  });

  it('decrypts seeker identity and location and removes departed participants', async () => {
    const service = TestBed.inject(LiveTrackingService);
    const code = await service.createSession('Hider');
    const client = FakeSignallingClient.instances[0];
    const invitation = code ? decodeLiveTrackingInvitation(code) : null;
    if (!invitation) {
      throw new Error('Expected an invitation');
    }

    const location = await encryptLiveTrackingMessage(invitation.key, {
      type: 'location',
      name: 'Seeker',
      position: { lat: 52.37, lng: 4.89, accuracyMeters: 12 },
      sentAt: Date.now(),
    });
    client.emit('message', {
      channel: invitation.channel,
      from: 'seeker-peer',
      data: location,
    });

    await vi.waitFor(() => expect(service.$remoteParticipants()).toHaveLength(1));
    expect(service.$remoteParticipants()[0]).toMatchObject({
      id: 'seeker-peer',
      name: 'Seeker',
      position: { lat: 52.37, lng: 4.89, accuracyMeters: 12 },
    });

    client.emit('presence', {
      channel: invitation.channel,
      joined: [],
      left: [{ peerId: 'seeker-peer' }],
    });
    expect(service.$remoteParticipants()).toHaveLength(0);
    expect(service.$status()).toBe('waiting');
  });
});
