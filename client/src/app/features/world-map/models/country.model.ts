import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface CountryGeometryProperties {
  A3: string;
  name?: string;
}

export interface CountryMetadataRecord {
  ccn3: string;
  cca3: string;
  cca2: string;
  name: string;
}

export type SourceCountryBoundaryFeature = Feature<
  Polygon | MultiPolygon,
  { name?: string }
>;

export type CountryBoundaryFeature = Feature<
  Polygon | MultiPolygon,
  CountryGeometryProperties
>;

export interface CountryRecord {
  code: string;
  code2: string;
  name: string;
  feature: CountryBoundaryFeature;
}

export interface CountryOption {
  code: string;
  name: string;
}

export type CountryFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  CountryGeometryProperties
>;
