import { Injectable, signal } from '@angular/core';

export interface UserLocation {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

export type LocationConsumer = 'map' | 'live-tracking';

@Injectable({ providedIn: 'root' })
export class UserLocationService {
  readonly $isTracking = signal(false);
  readonly $isMapTracking = signal(false);
  readonly $isLiveTracking = signal(false);
  readonly $position = signal<UserLocation | null>(null);
  readonly $error = signal<string | null>(null);
  readonly isSupported = typeof globalThis.navigator?.geolocation !== 'undefined';

  private watchId: number | null = null;
  private readonly consumers = new Set<LocationConsumer>();

  start(consumer: LocationConsumer = 'map'): void {
    this.consumers.add(consumer);
    this.syncTrackingSignals();
    if (this.watchId !== null) {
      return;
    }

    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      this.consumers.delete(consumer);
      this.syncTrackingSignals();
      this.$error.set('Location is not supported');
      return;
    }

    this.$error.set(null);
    try {
      let failedSynchronously = false;
      const watchId = geolocation.watchPosition(
        (position) => {
          this.$position.set({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          });
          this.$error.set(null);
        },
        (error) => {
          failedSynchronously = this.watchId === null;
          this.handleError(error);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        },
      );
      if (failedSynchronously) {
        geolocation.clearWatch(watchId);
      } else {
        this.watchId = watchId;
      }
    } catch {
      this.consumers.delete(consumer);
      this.syncTrackingSignals();
      this.$error.set('Unable to access location');
    }
  }

  stop(consumer: LocationConsumer = 'map'): void {
    this.consumers.delete(consumer);
    this.syncTrackingSignals();
    if (this.consumers.size > 0) {
      return;
    }

    if (this.watchId !== null) {
      globalThis.navigator?.geolocation?.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.$position.set(null);
    this.$error.set(null);
  }

  private handleError(error: GeolocationPositionError): void {
    if (this.watchId !== null) {
      globalThis.navigator?.geolocation?.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.consumers.clear();
    this.syncTrackingSignals();
    this.$position.set(null);
    this.$error.set(
      error.code === error.PERMISSION_DENIED
        ? 'Location permission denied'
        : error.code === error.TIMEOUT
          ? 'Location timed out - retry'
          : 'Location unavailable - retry',
    );
  }

  private syncTrackingSignals(): void {
    this.$isTracking.set(this.consumers.size > 0);
    this.$isMapTracking.set(this.consumers.has('map'));
    this.$isLiveTracking.set(this.consumers.has('live-tracking'));
  }
}
