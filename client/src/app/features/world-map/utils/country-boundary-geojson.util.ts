import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export function toCountryBoundaryFeatureCollection(
  boundary: unknown
): FeatureCollection<Polygon | MultiPolygon> | null {
  if (!boundary || typeof boundary !== 'object') {
    return null;
  }

  if (isPolygonFeatureCollection(boundary)) {
    return boundary;
  }

  if (isPolygonFeature(boundary)) {
    return {
      type: 'FeatureCollection',
      features: [boundary]
    };
  }

  if (isPolygonGeometry(boundary)) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: boundary
        }
      ]
    };
  }

  return null;
}

export function isPolygonFeatureCollection(
  value: unknown
): value is FeatureCollection<Polygon | MultiPolygon> {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: string }).type === 'FeatureCollection' &&
    Array.isArray((value as { features?: unknown[] }).features) &&
    (value as { features: unknown[] }).features.every((feature) =>
      isPolygonFeature(feature)
    )
  );
}

export function isPolygonFeature(
  value: unknown
): value is Feature<Polygon | MultiPolygon> {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: string }).type === 'Feature' &&
    isPolygonGeometry((value as { geometry?: unknown }).geometry)
  );
}

export function isPolygonGeometry(value: unknown): value is Polygon | MultiPolygon {
  return (
    !!value &&
    typeof value === 'object' &&
    ((value as { type?: string }).type === 'Polygon' ||
      (value as { type?: string }).type === 'MultiPolygon')
  );
}
