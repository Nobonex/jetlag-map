import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import * as polygonClipping from 'polygon-clipping';

type ClippingPair = polygonClipping.Pair;
type ClippingRing = polygonClipping.Ring;
type ClippingPolygon = polygonClipping.Polygon;
type ClippingMultiPolygon = polygonClipping.MultiPolygon;
type PolygonClippingApi = typeof import('polygon-clipping');

const polygonClippingApi = (
  polygonClipping as PolygonClippingApi & { default?: PolygonClippingApi }
).default ?? (polygonClipping as PolygonClippingApi);

export function buildOutsideMask(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>
): FeatureCollection<Polygon> {
  const holes = toMaskHoles(geometry);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [WORLD_RING, ...holes]
        }
      }
    ]
  };
}

export function buildRadarMask(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>,
  radarArea: Feature<Polygon>,
  mode: 'inside' | 'outside'
): FeatureCollection<Polygon> {
  return mode === 'inside'
    ? subtractGeometry(geometry, radarArea)
    : intersectGeometry(geometry, radarArea);
}

export function subtractGeometry(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>,
  mask: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>
): FeatureCollection<Polygon> {
  const targetGeometry = toClippingFeatureMultiPolygon(geometry);
  const maskGeometry = toClippingFeatureMultiPolygon(mask);
  const difference = polygonClippingApi.difference(targetGeometry, maskGeometry) ?? [];

  return toFeatureCollection(difference);
}

export function intersectGeometry(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>,
  mask: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>
): FeatureCollection<Polygon> {
  const targetGeometry = toClippingFeatureMultiPolygon(geometry);
  const maskGeometry = toClippingFeatureMultiPolygon(mask);
  const intersection = polygonClippingApi.intersection(targetGeometry, maskGeometry) ?? [];

  return toFeatureCollection(intersection);
}

const WORLD_RING: Polygon['coordinates'][number] = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90]
];

function toMaskHoles(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>
): Polygon['coordinates'] {
  const features = 'features' in geometry ? geometry.features : [geometry];
  const holes: Polygon['coordinates'] = [];

  for (const feature of features) {
    if (feature.geometry.type === 'Polygon') {
      holes.push(closeRing(feature.geometry.coordinates[0]));
      continue;
    }

    for (const polygon of feature.geometry.coordinates) {
      holes.push(closeRing(polygon[0]));
    }
  }

  return holes;
}

function closeRing(ring: Polygon['coordinates'][number]): Polygon['coordinates'][number] {
  if (ring.length === 0) {
    return ring;
  }

  const firstPosition = ring[0];
  const lastPosition = ring[ring.length - 1];
  if (firstPosition[0] === lastPosition[0] && firstPosition[1] === lastPosition[1]) {
    return ring;
  }

  return [...ring, firstPosition];
}

function toFeatureCollection(geometry: ClippingMultiPolygon): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: geometry.map((polygon) => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: polygon as unknown as Polygon['coordinates']
      }
    }))
  };
}

function toClippingFeatureMultiPolygon(
  geometry: FeatureCollection<Polygon | MultiPolygon> | Feature<Polygon | MultiPolygon>
): ClippingMultiPolygon {
  const features = 'features' in geometry ? geometry.features : [geometry];
  const polygons: ClippingMultiPolygon = [];

  for (const feature of features) {
    if (feature.geometry.type === 'Polygon') {
      polygons.push(toClippingPolygon(feature.geometry.coordinates));
      continue;
    }

    polygons.push(...toClippingMultiPolygon(feature.geometry.coordinates));
  }

  return polygons;
}

function toClippingPolygon(coordinates: Polygon['coordinates']): ClippingPolygon {
  return coordinates.map((ring) =>
    ring.map((position) => [position[0], position[1]] as ClippingPair)
  ) as ClippingRing[];
}

function toClippingMultiPolygon(
  coordinates: MultiPolygon['coordinates']
): ClippingMultiPolygon {
  return coordinates.map((polygon) => toClippingPolygon(polygon));
}
