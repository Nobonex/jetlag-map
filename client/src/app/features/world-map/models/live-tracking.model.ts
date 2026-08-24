import type { UserLocation } from '../services/user-location.service';

export type LiveTrackingRole = 'hider' | 'seeker';
export type LiveTrackingStatus =
  | 'idle'
  | 'preparing'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'error';

export interface RemoteParticipant {
  id: string;
  name: string;
  position: UserLocation | null;
  lastSeen: number | null;
  connectionState: RTCPeerConnectionState;
}

export interface LiveLocationMessage {
  type: 'location';
  position: UserLocation;
  sentAt: number;
}

export interface LiveSessionMessage {
  type: 'session';
  expiresAt: number;
}

export type LiveTrackingMessage = LiveLocationMessage | LiveSessionMessage;
