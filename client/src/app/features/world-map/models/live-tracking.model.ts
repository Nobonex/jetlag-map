import type { UserLocation } from '../services/user-location.service';

export type LiveTrackingRole = 'hider' | 'seeker';
export type LiveTrackingStatus =
  | 'idle'
  | 'preparing'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface RemoteParticipant {
  id: string;
  name: string;
  position: UserLocation | null;
  lastSeen: number | null;
  connectionState: 'connected' | 'disconnected';
}

export interface LiveLocationMessage {
  type: 'location';
  name: string;
  position: UserLocation;
  sentAt: number;
}

export interface LiveSessionMessage {
  type: 'session';
  expiresAt: number;
  sentAt: number;
}

export interface LiveHelloMessage {
  type: 'hello';
  name: string;
  sentAt: number;
}

export type LiveTrackingMessage = LiveHelloMessage | LiveLocationMessage | LiveSessionMessage;

export interface LiveTrackingInvitation {
  channel: string;
  key: Uint8Array<ArrayBuffer>;
  expiresAt: number;
}

export interface EncryptedLiveTrackingMessage {
  version: 1;
  iv: string;
  ciphertext: string;
}
