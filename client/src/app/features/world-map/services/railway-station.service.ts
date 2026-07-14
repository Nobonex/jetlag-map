import { Injectable, signal } from '@angular/core';

import type { CountryRecord } from '../models/country.model';
import type { RailwayStation } from '../models/railway-station.model';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const REQUEST_TIMEOUT_MS = 60000;

@Injectable({ providedIn: 'root' })
export class RailwayStationService {
  readonly $isLoading = signal(false);
  readonly $error = signal<string | null>(null);

  private readonly cache = new Map<string, RailwayStation[]>();
  private activeController: AbortController | null = null;
  private activeCountryCode: string | null = null;
  private activeRequest: Promise<RailwayStation[]> | null = null;

  loadStations(country: CountryRecord): Promise<RailwayStation[]> {
    const cached = this.cache.get(country.code);
    if (cached) {
      this.$error.set(null);
      return Promise.resolve(cached);
    }

    if (this.activeCountryCode === country.code && this.activeRequest) {
      return this.activeRequest;
    }

    this.cancelRequest();
    const controller = new AbortController();
    this.activeController = controller;
    this.activeCountryCode = country.code;
    this.$isLoading.set(true);
    this.$error.set(null);

    const request = this.fetchStations(country, controller);
    this.activeRequest = request;
    return request;
  }

  cancelRequest(): void {
    this.activeController?.abort();
    this.activeController = null;
    this.activeCountryCode = null;
    this.activeRequest = null;
    this.$isLoading.set(false);
    this.$error.set(null);
  }

  private async fetchStations(
    country: CountryRecord,
    controller: AbortController,
  ): Promise<RailwayStation[]> {
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: buildOverpassQuery(country.code2) }).toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Overpass request failed with status ${response.status}`);
      }

      const payload: unknown = await response.json();
      const stations = parseOverpassStations(payload);
      if (this.activeController === controller) {
        this.cache.set(country.code, stations);
        this.$error.set(null);
      }
      return stations;
    } catch (error: unknown) {
      if (!isAbortError(error) && this.activeController === controller) {
        this.$error.set('Train stations could not be loaded');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.activeController === controller) {
        this.activeController = null;
        this.activeCountryCode = null;
        this.activeRequest = null;
        this.$isLoading.set(false);
      }
    }
  }
}

function buildOverpassQuery(countryCode2: string): string {
  return `[out:json][timeout:60];
area["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="${countryCode2}"]->.country;
nwr(area.country)["railway"~"^(station|halt)$"]["station"!~"^(subway|light_rail)$"];
out center qt;`;
}

function parseOverpassStations(value: unknown): RailwayStation[] {
  if (!isRecord(value) || !Array.isArray(value['elements'])) {
    throw new Error('Invalid Overpass response');
  }

  const stations: RailwayStation[] = [];
  const seenIds = new Set<string>();
  for (const element of value['elements']) {
    const station = parseOverpassElement(element);
    if (station && !seenIds.has(station.id)) {
      seenIds.add(station.id);
      stations.push(station);
    }
  }
  return stations;
}

function parseOverpassElement(value: unknown): RailwayStation | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value['type'];
  const id = value['id'];
  if ((type !== 'node' && type !== 'way' && type !== 'relation') || !isFiniteNumber(id)) {
    return null;
  }

  const tags = isRecord(value['tags']) ? value['tags'] : null;
  const railway = tags?.['railway'];
  const stationType = tags?.['station'];
  if (
    (railway !== 'station' && railway !== 'halt') ||
    stationType === 'subway' ||
    stationType === 'light_rail'
  ) {
    return null;
  }

  const center = isRecord(value['center']) ? value['center'] : value;
  const lat = center['lat'];
  const lng = center['lon'];
  if (
    !isFiniteNumber(lat) ||
    lat < -90 ||
    lat > 90 ||
    !isFiniteNumber(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    id: `${type}/${id}`,
    name: typeof tags?.['name'] === 'string' ? tags['name'] : null,
    lat,
    lng,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
