import type { MultiPolygon, Polygon } from 'geojson';

export interface NominatimSearchResult {
  osm_type?: string;
  type?: string;
  addresstype?: string;
  place_rank?: number;
  importance?: number;
  boundingbox?: string[];
  geojson?: Polygon | MultiPolygon;
}
