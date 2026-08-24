import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveTrackingService } from './live-tracking.service';
import { UserLocationService } from './user-location.service';

type EventHandler = (...args: never[]) => void;

class FakeDataConnection {
  readonly connectionId = crypto.randomUUID();
  readonly peerConnection = { connectionState: 'new' };
  readonly dataChannel = {};
  readonly send = vi.fn();
  open = false;
  readonly peer: string;
  readonly label: string;
  readonly metadata: unknown;
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor(peer: string, options: { label?: string; metadata?: unknown } = {}) {
    this.peer = peer;
    this.label = options.label ?? '';
    this.metadata = options.metadata;
  }

  on(event: string, handler: EventHandler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...(args as never[]));
    }
  }

  emitOpen(): void {
    this.open = true;
    this.emit('open');
  }

  close(): void {
    const wasOpen = this.open;
    this.open = false;
    if (wasOpen) {
      this.emit('close');
    }
  }
}

class FakePeer {
  static instances: FakePeer[] = [];

  readonly connectionsCreated: FakeDataConnection[] = [];
  id = '';
  open = false;
  destroyed = false;
  disconnected = false;
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor() {
    FakePeer.instances.push(this);
  }

  on(event: string, handler: EventHandler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...(args as never[]));
    }
  }

  emitOpen(id: string): void {
    this.id = id;
    this.open = true;
    this.emit('open', id);
  }

  connect(peerId: string, options: { label?: string; metadata?: unknown }): FakeDataConnection {
    const connection = new FakeDataConnection(peerId, options);
    this.connectionsCreated.push(connection);
    return connection;
  }

  reconnect(): void {
    this.disconnected = false;
  }

  destroy(): void {
    this.destroyed = true;
    this.open = false;
  }
}

vi.mock('peerjs', () => ({ Peer: FakePeer }));

describe('LiveTrackingService', () => {
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const locationService = {
    $position: signal(null),
    $error: signal(null),
    start: vi.fn(),
    stop: vi.fn(),
  };

  beforeEach(() => {
    globalThis.RTCPeerConnection = class {} as unknown as typeof RTCPeerConnection;
    FakePeer.instances = [];
    locationService.$position.set(null);
    locationService.$error.set(null);
    locationService.start.mockClear();
    locationService.stop.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: UserLocationService, useValue: locationService }],
    });
  });

  afterEach(() => {
    TestBed.inject(LiveTrackingService).stop();
    globalThis.RTCPeerConnection = originalPeerConnection;
    vi.restoreAllMocks();
  });

  it('creates one reusable hider session code', async () => {
    const service = TestBed.inject(LiveTrackingService);
    const result = service.createSession('Hider');
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));

    FakePeer.instances[0].emitOpen('hider-peer-123');

    await expect(result).resolves.toBe('JLM1.hider-peer-123');
    expect(service.$role()).toBe('hider');
    expect(service.$status()).toBe('waiting');
    expect(service.$invitationCode()).toBe('JLM1.hider-peer-123');
  });

  it('connects a seeker automatically and starts location only after the channel opens', async () => {
    const service = TestBed.inject(LiveTrackingService);
    const result = service.joinSession('JLM1.hider-peer-123', 'Seeker');
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    const peer = FakePeer.instances[0];

    peer.emitOpen('seeker-peer-456');
    await expect(result).resolves.toBe(true);
    expect(service.$status()).toBe('connecting');
    expect(locationService.start).not.toHaveBeenCalled();

    peer.connectionsCreated[0].emitOpen();

    expect(service.$status()).toBe('connected');
    expect(locationService.start).toHaveBeenCalledWith('live-tracking');

    peer.connectionsCreated[0].close();
    expect(service.$status()).toBe('waiting');

    await service.reconnect();
    expect(peer.connectionsCreated).toHaveLength(2);
    peer.connectionsCreated[1].emitOpen();
    expect(service.$status()).toBe('connected');
  });

  it('counts an incoming seeker only after its data channel opens', async () => {
    const service = TestBed.inject(LiveTrackingService);
    const result = service.createSession('Hider');
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    const peer = FakePeer.instances[0];
    peer.emitOpen('hider-peer-123');
    await result;
    const incoming = new FakeDataConnection('seeker-peer-456', {
      label: 'jetlag-live-location-v1',
      metadata: { protocol: 'jetlag-live-location-v1', name: 'Seeker' },
    });

    peer.emit('connection', incoming);
    expect(service.$remoteParticipants()).toHaveLength(0);

    incoming.emitOpen();

    expect(service.$remoteParticipants()).toHaveLength(1);
    expect(service.$remoteParticipants()[0].name).toBe('Seeker');
    expect(service.$status()).toBe('connected');
  });
});
