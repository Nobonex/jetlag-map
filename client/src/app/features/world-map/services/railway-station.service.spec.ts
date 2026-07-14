import type { CountryRecord } from '../models/country.model';
import { RailwayStationService } from './railway-station.service';

describe('RailwayStationService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads, validates, filters, and caches train stations and halts', async () => {
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toContain('ISO3166-1%22%3D%22AF');
      expect(String(init?.body)).toContain('station%7Chalt');
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 34.5,
              lon: 69.2,
              tags: { railway: 'station', name: 'Central' },
            },
            {
              type: 'node',
              id: 2,
              lat: 34.6,
              lon: 69.3,
              tags: { railway: 'halt' },
            },
            {
              type: 'way',
              id: 3,
              center: { lat: 34.7, lon: 69.4 },
              tags: { railway: 'station', name: 'West' },
            },
            {
              type: 'node',
              id: 4,
              lat: 34.8,
              lon: 69.5,
              tags: { railway: 'station', station: 'subway' },
            },
            {
              type: 'node',
              id: 5,
              lat: 120,
              lon: 69.6,
              tags: { railway: 'station' },
            },
          ],
        }),
      );
    }) as typeof fetch;
    const service = new RailwayStationService();

    const firstResult = await service.loadStations(createCountry());
    const cachedResult = await service.loadStations(createCountry());

    expect(firstResult).toEqual([
      { id: 'node/1', name: 'Central', lat: 34.5, lng: 69.2 },
      { id: 'node/2', name: null, lat: 34.6, lng: 69.3 },
      { id: 'way/3', name: 'West', lat: 34.7, lng: 69.4 },
    ]);
    expect(cachedResult).toBe(firstResult);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(service.$isLoading()).toBe(false);
    expect(service.$error()).toBeNull();
  });

  it('exposes a retryable error for failed requests', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as typeof fetch;
    const service = new RailwayStationService();

    await expect(service.loadStations(createCountry())).rejects.toThrow('status 503');

    expect(service.$isLoading()).toBe(false);
    expect(service.$error()).toBe('Train stations could not be loaded');
  });
});

function createCountry(): CountryRecord {
  return {
    code: 'AFG',
    code2: 'AF',
    name: 'Afghanistan',
    feature: {
      type: 'Feature',
      properties: { A3: 'AFG', name: 'Afghanistan' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [60, 29],
            [75, 29],
            [75, 39],
            [60, 29],
          ],
        ],
      },
    },
  };
}
