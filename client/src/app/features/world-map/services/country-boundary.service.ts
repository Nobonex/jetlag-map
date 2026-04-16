import { Injectable, signal } from '@angular/core';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import {
  createCountryRecords,
  getCountryRecordByCode,
  toCountryFeatureCollection,
  toCountryOptions
} from '../utils/country-records.util';
import {
  type CountryFeatureCollection,
  type CountryMetadataRecord,
  type CountryOption,
  type CountryRecord
} from '../models/country.model';
import type { NominatimSearchResult } from '../models/nominatim-search-result.model';
import {
  isPolygonGeometry,
  toCountryBoundaryFeatureCollection
} from '../utils/country-boundary-geojson.util';

const COUNTRY_GEOMETRY_CACHE_PREFIX = 'jetlag-country-boundary-v2:';

@Injectable({ providedIn: 'root' })
export class CountryBoundaryService {
  readonly countryOptions = signal<CountryOption[]>([]);
  readonly isLoadingCountries = signal(true);

  private countryRecords: CountryRecord[] = [];
  private readonly detailedCountryGeometries = new Map<
    string,
    FeatureCollection<Polygon | MultiPolygon>
  >();
  private readonly detailedCountryGeometryRequests = new Map<string, Promise<void>>();
  private countryFeatureCollection: CountryFeatureCollection = {
    type: 'FeatureCollection',
    features: []
  };
  private loadCountriesPromise: Promise<void> | null = null;

  loadCountries(): Promise<void> {
    if (this.loadCountriesPromise) {
      return this.loadCountriesPromise;
    }

    this.loadCountriesPromise = this.loadCountryData();
    return this.loadCountriesPromise;
  }

  getCountryFeatureCollection(): CountryFeatureCollection {
    return this.countryFeatureCollection;
  }

  getCountryByCode(code: string | null | undefined): CountryRecord | null {
    return getCountryRecordByCode(code, this.countryRecords);
  }

  getCountryGeometry(
    countryCode: string
  ): FeatureCollection<Polygon | MultiPolygon> | null {
    const detailedGeometry = this.detailedCountryGeometries.get(countryCode);
    if (detailedGeometry) {
      return detailedGeometry;
    }

    const country = this.getCountryByCode(countryCode);
    return country
      ? {
          type: 'FeatureCollection',
          features: [country.feature]
        }
      : null;
  }

  loadDetailedCountryGeometry(countryCode: string): Promise<void> {
    const country = this.getCountryByCode(countryCode);
    if (!country) {
      return Promise.resolve();
    }

    return this.ensureDetailedCountryGeometry(country);
  }

  private async loadCountryData(): Promise<void> {
    try {
      const [topology, countries] = await Promise.all([
        fetch('assets/countries-10m.topo.json').then((response) => response.json()),
        fetch('assets/sovereign-countries.json').then((response) => response.json())
      ]);

      const countryFeatures = feature(
        topology as CountriesTopology,
        (topology as CountriesTopology).objects.countries
      ) as FeatureCollection<Polygon | MultiPolygon, { name?: string }>;

      this.countryRecords = createCountryRecords(
        countryFeatures,
        countries as CountryMetadataRecord[]
      );
      this.countryFeatureCollection = toCountryFeatureCollection(this.countryRecords);
      this.countryOptions.set(toCountryOptions(this.countryRecords));
    } catch (error) {
      console.error('Failed to load country boundaries.', error);
    } finally {
      this.isLoadingCountries.set(false);
    }
  }

  private ensureDetailedCountryGeometry(country: CountryRecord): Promise<void> {
    if (this.detailedCountryGeometries.has(country.code)) {
      return Promise.resolve();
    }

    const cachedGeometry = this.getCachedCountryGeometry(country.code);
    if (cachedGeometry) {
      this.detailedCountryGeometries.set(country.code, cachedGeometry);
      return Promise.resolve();
    }

    const existingRequest = this.detailedCountryGeometryRequests.get(country.code);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.fetchCountryBoundaryGeometry(country)
      .then((geometry) => {
        this.detailedCountryGeometries.set(country.code, geometry);
        this.setCachedCountryGeometry(country.code, geometry);
      })
      .catch((error) => {
        console.error(`Failed to load exact geometry for ${country.code}.`, error);
      })
      .finally(() => {
        this.detailedCountryGeometryRequests.delete(country.code);
      });

    this.detailedCountryGeometryRequests.set(country.code, request);
    return request;
  }

  private async fetchCountryBoundaryGeometry(
    country: CountryRecord
  ): Promise<FeatureCollection<Polygon | MultiPolygon>> {
    const nominatimGeometry = await this.fetchNominatimCountryGeometry(country);
    if (nominatimGeometry) {
      return nominatimGeometry;
    }

    const fallbackResponse = await fetch(
      `assets/countries/${country.code.toLowerCase()}.geo.json`
    );
    if (!fallbackResponse.ok) {
      throw new Error(`Unable to load fallback geometry for ${country.code}.`);
    }

    const fallbackBoundary = toCountryBoundaryFeatureCollection(
      (await fallbackResponse.json()) as unknown
    );

    if (!fallbackBoundary) {
      throw new Error(`Fallback geometry is invalid for ${country.code}.`);
    }

    return fallbackBoundary;
  }

  private async fetchNominatimCountryGeometry(
    country: CountryRecord
  ): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
    const response = await fetch(this.buildNominatimSearchUrl(country));

    if (!response.ok) {
      throw new Error(`Nominatim search failed for ${country.code}.`);
    }

    const results = (await response.json()) as NominatimSearchResult[];
    const selectedResult = this.pickPreferredNominatimResult(results);

    return selectedResult
      ? toCountryBoundaryFeatureCollection(selectedResult.geojson)
      : null;
  }

  private buildNominatimSearchUrl(country: CountryRecord): string {
    const params = new URLSearchParams({
      format: 'jsonv2',
      polygon_geojson: '1',
      polygon_threshold: '0',
      limit: '5',
      q: country.name,
      countrycodes: country.code2.toLowerCase()
    });

    return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  }

  private pickPreferredNominatimResult(
    results: NominatimSearchResult[]
  ): NominatimSearchResult | null {
    const candidates = results
      .filter(
        (result) =>
          result.osm_type === 'relation' &&
          result.type === 'administrative' &&
          result.addresstype === 'country' &&
          !!result.geojson &&
          isPolygonGeometry(result.geojson)
      )
      .sort((left, right) => {
        const placeRankDelta = (right.place_rank ?? 0) - (left.place_rank ?? 0);
        if (placeRankDelta !== 0) {
          return placeRankDelta;
        }

        const areaDelta =
          this.approximateBoundingBoxArea(left.boundingbox) -
          this.approximateBoundingBoxArea(right.boundingbox);
        if (areaDelta !== 0) {
          return areaDelta;
        }

        return (right.importance ?? 0) - (left.importance ?? 0);
      });

    return candidates[0] ?? null;
  }

  private approximateBoundingBoxArea(boundingbox: string[] | undefined): number {
    if (!boundingbox || boundingbox.length !== 4) {
      return Number.POSITIVE_INFINITY;
    }

    const [south, north, west, east] = boundingbox.map((value) =>
      Number.parseFloat(value)
    );
    if ([south, north, west, east].some((value) => Number.isNaN(value))) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.abs((north - south) * (east - west));
  }

  private getCachedCountryGeometry(
    countryCode: string
  ): FeatureCollection<Polygon | MultiPolygon> | null {
    try {
      const serialized = globalThis.localStorage?.getItem(
        `${COUNTRY_GEOMETRY_CACHE_PREFIX}${countryCode}`
      );

      if (!serialized) {
        return null;
      }

      return toCountryBoundaryFeatureCollection(JSON.parse(serialized));
    } catch {
      return null;
    }
  }

  private setCachedCountryGeometry(
    countryCode: string,
    geometry: FeatureCollection<Polygon | MultiPolygon>
  ): void {
    try {
      globalThis.localStorage?.setItem(
        `${COUNTRY_GEOMETRY_CACHE_PREFIX}${countryCode}`,
        JSON.stringify(geometry)
      );
    } catch {
      // Ignore quota and storage-access failures.
    }
  }
}

interface CountriesTopology extends Topology {
  objects: {
    countries: GeometryCollection<{
      name?: string;
    }>;
  };
}
