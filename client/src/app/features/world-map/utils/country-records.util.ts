import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import type {
  CountryFeatureCollection,
  CountryMetadataRecord,
  CountryOption,
  CountryRecord,
  SourceCountryBoundaryFeature
} from '../models/country.model';

export function createCountryRecords(
  geometry: FeatureCollection<Polygon | MultiPolygon, { name?: string }>,
  countries: CountryMetadataRecord[]
): CountryRecord[] {
  const featureByNumericCode = new Map(
    geometry.features
      .map((feature) => {
        const numericCode = normalizeCountryNumericCode(feature.id);
        return numericCode ? ([numericCode, feature] as const) : null;
      })
      .filter(
        (
          entry
        ): entry is readonly [string, SourceCountryBoundaryFeature] => entry !== null
      )
  );

  const records: CountryRecord[] = [];

  for (const country of countries) {
    const feature = featureByNumericCode.get(country.ccn3);

    if (!feature) {
      continue;
    }

    records.push({
      code: country.cca3,
      code2: country.cca2,
      name: country.name,
      feature: {
        ...feature,
        properties: {
          ...feature.properties,
          A3: country.cca3
        }
      }
    });
  }

  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export function toCountryOptions(countries: CountryRecord[]): CountryOption[] {
  return countries.map(({ code, name }) => ({ code, name }));
}

export function toCountryFeatureCollection(
  countries: CountryRecord[]
): CountryFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: countries.map((country) => country.feature)
  };
}

export function getCountryRecordByCode(
  code: string | null | undefined,
  countries: CountryRecord[]
): CountryRecord | null {
  if (!code) {
    return null;
  }

  return countries.find((country) => country.code === code) ?? null;
}

function normalizeCountryNumericCode(
  numericCode: string | number | undefined
): string | null {
  if (numericCode === undefined) {
    return null;
  }

  return String(numericCode).padStart(3, '0');
}
