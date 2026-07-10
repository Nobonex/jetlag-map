import { Injectable, signal } from '@angular/core';

export interface UserLocation {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

@Injectable({ providedIn: 'root' })
export class UserLocationService {
  readonly $isTracking = signal(false);
  readonly $position = signal<UserLocation | null>(null);
  readonly $error = signal<string | null>(null);
  readonly isSupported = typeof globalThis.navigator?.geolocation !== 'undefined';

  private watchId: number | null = null;

  start(): void {
    if (this.watchId !== null) {
      return;
    }

    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      this.$error.set('Location is not supported');
      return;
    }

    this.$error.set(null);
    this.$isTracking.set(true);
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
      this.$isTracking.set(false);
      this.$error.set('Unable to access location');
    }
  }

  stop(): void {
    if (this.watchId !== null) {
      globalThis.navigator?.geolocation?.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.$isTracking.set(false);
    this.$position.set(null);
    this.$error.set(null);
  }

  private handleError(error: GeolocationPositionError): void {
    if (this.watchId !== null) {
      globalThis.navigator?.geolocation?.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.$isTracking.set(false);
    this.$position.set(null);
    this.$error.set(
      error.code === error.PERMISSION_DENIED
        ? 'Location permission denied'
        : error.code === error.TIMEOUT
          ? 'Location timed out - retry'
          : 'Location unavailable - retry',
    );
  }
}
