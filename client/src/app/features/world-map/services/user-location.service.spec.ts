import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserLocationService } from './user-location.service';

describe('UserLocationService', () => {
  const originalGeolocation = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation');

  afterEach(() => {
    if (originalGeolocation) {
      Object.defineProperty(globalThis.navigator, 'geolocation', originalGeolocation);
    } else {
      Reflect.deleteProperty(globalThis.navigator, 'geolocation');
    }
  });

  it('streams positions and clears the watcher when stopped', () => {
    let positionCallback: PositionCallback | undefined;
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((success: PositionCallback) => {
      positionCallback = success;
      return 17;
    });
    setGeolocation({ watchPosition, clearWatch });
    const service = new UserLocationService();

    service.start();
    positionCallback?.({
      coords: {
        latitude: 51.5,
        longitude: -0.12,
        accuracy: 8,
      },
    } as GeolocationPosition);

    expect(service.$isTracking()).toBe(true);
    expect(service.$position()).toEqual({ lat: 51.5, lng: -0.12, accuracyMeters: 8 });
    expect(watchPosition).toHaveBeenCalledOnce();

    service.stop();

    expect(clearWatch).toHaveBeenCalledWith(17);
    expect(service.$isTracking()).toBe(false);
    expect(service.$position()).toBeNull();
  });

  it('reports permission errors and stops tracking', () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((_: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      return 23;
    });
    setGeolocation({ watchPosition, clearWatch });
    const service = new UserLocationService();

    service.start();

    expect(service.$isTracking()).toBe(false);
    expect(service.$error()).toBe('Location permission denied');
    expect(clearWatch).toHaveBeenCalledWith(23);
  });
});

function setGeolocation(value: Pick<Geolocation, 'watchPosition' | 'clearWatch'>): void {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value,
  });
}
