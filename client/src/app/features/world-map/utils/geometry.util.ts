import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import * as L from 'leaflet';

import type { RadarQuestion } from '../models/radar-question.model';
import type { QuestionCenter } from '../models/question.model';
import type { ThermometerMode } from '../models/thermometer-question.model';

const RADAR_CIRCLE_POINT_COUNT = 96;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function createCirclePolygon(center: L.LatLng, radiusMeters: number): Polygon {
  const angularDistance = radiusMeters / 6371008.8;
  const latitudeRadians = degreesToRadians(center.lat);
  const longitudeRadians = degreesToRadians(center.lng);
  const coordinates: Position[] = [];

  for (let index = 0; index <= RADAR_CIRCLE_POINT_COUNT; index += 1) {
    const bearing = (2 * Math.PI * index) / RADAR_CIRCLE_POINT_COUNT;
    const nextLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance) +
        Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const nextLongitude =
      longitudeRadians +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitude),
      );

    coordinates.push([normalizeLongitude(radiansToDegrees(nextLongitude)), radiansToDegrees(nextLatitude)]);
  }

  return {
    type: 'Polygon',
    coordinates: [coordinates],
  };
}

export function toPolygonFeatureCollection(
  geometry: FeatureCollection<Polygon | MultiPolygon>,
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: geometry.features.flatMap((feature) => {
      if (feature.geometry.type === 'Polygon') {
        return [
          {
            type: 'Feature' as const,
            properties: feature.properties ?? {},
            geometry: feature.geometry,
          },
        ];
      }

      return feature.geometry.coordinates.map((coordinates) => ({
        type: 'Feature' as const,
        properties: feature.properties ?? {},
        geometry: {
          type: 'Polygon' as const,
          coordinates,
        },
      }));
    }),
  };
}

export function getBoundingBox(
  geometry: FeatureCollection<Polygon | MultiPolygon>,
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;

  for (const feature of geometry.features) {
    const rings =
      feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flatMap((polygon) => polygon);

    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  return { minLng, maxLng, minLat, maxLat };
}

export function createRadarMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'radar-center-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span class="radar-center-marker__dot" style="--radar-color: ${color}"></span>`,
  });
}

export function getRadarQuestionBounds(question: RadarQuestion): L.LatLngBounds {
  const radarFeature: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: createCirclePolygon(L.latLng(question.center.lat, question.center.lng), question.applied.radiusKm * 1000),
  };

  return L.geoJSON(radarFeature).getBounds();
}

export function getBisectorPoints(
  start: QuestionCenter,
  end: QuestionCenter,
  extent: number,
): { p1: [number, number]; p2: [number, number] } {
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;

  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const bx = -dy / len;
  const by = dx / len;

  return {
    p1: [normalizeLongitude(midLng - extent * bx), clamp(midLat - extent * by, -90, 90)],
    p2: [normalizeLongitude(midLng + extent * bx), clamp(midLat + extent * by, -90, 90)],
  };
}

/**
 * Returns the two points where the perpendicular bisector of [start, end]
 * intersects the given bounding-box edges. This gives an edge-to-edge line
 * that always passes through the midpoint and is guaranteed to span the
 * full bbox, making the bisector unmistakably visible on the map.
 */
export function getBisectorEdgePoints(
  start: QuestionCenter,
  end: QuestionCenter,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): { p1: [number, number]; p2: [number, number] } {
  const midLng = (start.lng + end.lng) / 2;
  const midLat = (start.lat + end.lat) / 2;

  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Bisector direction vector (perpendicular to AB)
  const dirLng = -dy / len;
  const dirLat = dx / len;

  const ts: number[] = [];
  const EPS = 1e-12;

  if (Math.abs(dirLng) > EPS) {
    ts.push((bbox.minLng - midLng) / dirLng);
    ts.push((bbox.maxLng - midLng) / dirLng);
  }
  if (Math.abs(dirLat) > EPS) {
    ts.push((bbox.minLat - midLat) / dirLat);
    ts.push((bbox.maxLat - midLat) / dirLat);
  }

  const points = ts
    .map((t) => ({
      lng: midLng + t * dirLng,
      lat: midLat + t * dirLat,
      t,
    }))
    .filter(
      (p) =>
        p.lng >= bbox.minLng - EPS &&
        p.lng <= bbox.maxLng + EPS &&
        p.lat >= bbox.minLat - EPS &&
        p.lat <= bbox.maxLat + EPS,
    )
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) {
    // Fallback: the bisector is parallel to an edge and completely inside;
    // use a long fixed extent instead.
    return getBisectorPoints(start, end, 90);
  }

  return {
    p1: [points[0].lng, points[0].lat],
    p2: [points[points.length - 1].lng, points[points.length - 1].lat],
  };
}

/**
 * Builds a bounded half-plane polygon clipped to the given bounding box.
 *
 * The bisector line is the perpendicular bisector of the segment [start, end].
 * The playable side is determined by `mode`:
 *   - 'warmer'  → side that contains the `end` marker
 *   - 'colder'  → side that contains the `start` marker
 *
 * Instead of creating a huge half-plane and intersecting it with country geometry
 * (which polygon-clipping struggles with), we construct the polygon directly from
 * the bbox corners that lie on the playable side plus the two bisector–bbox-edge
 * intersection points. The result is a small convex polygon (4–6 vertices) that
 * any clipper can handle reliably.
 */
export function createThermometerAreaPolygon(
  start: QuestionCenter,
  end: QuestionCenter,
  mode: ThermometerMode,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): Polygon {
  const midLng = (start.lng + end.lng) / 2;
  const midLat = (start.lat + end.lat) / 2;

  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ex = dx / len;
  const ey = dy / len;

  // For 'warmer': playable side contains end   marker  →  ex*(lng-midLng) + ey*(lat-midLat)  > 0
  // For 'colder': playable side contains start marker  →  ex*(lng-midLng) + ey*(lat-midLat)  < 0
  const side = mode === 'warmer' ? 1 : -1;
  const EPS = 1e-10;

  const corners: [number, number][] = [
    [bbox.minLng, bbox.minLat], // 0: bottom-left
    [bbox.maxLng, bbox.minLat], // 1: bottom-right
    [bbox.maxLng, bbox.maxLat], // 2: top-right
    [bbox.minLng, bbox.maxLat], // 3: top-left
  ];

  const values = corners.map(
    ([lng, lat]) => ex * (lng - midLng) + ey * (lat - midLat),
  );

  const isPlayable = (v: number) => v * side >= -EPS;

  const ring: [number, number][] = [];

  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const vi = values[i];
    const vj = values[j];
    const ci = corners[i];
    const cj = corners[j];
    const playI = isPlayable(vi);
    const playJ = isPlayable(vj);

    if (playI) {
      ring.push([ci[0], ci[1]]);
    }

    // Edge crosses the bisector when the signs differ.
    if (playI !== playJ && Math.abs(vj - vi) > EPS) {
      const t = -vi / (vj - vi); // parameter along edge where value == 0
      const ix = ci[0] + t * (cj[0] - ci[0]);
      const iy = ci[1] + t * (cj[1] - ci[1]);
      ring.push([ix, iy]);
    }
  }

  if (ring.length > 0) {
    ring.push([ring[0][0], ring[0][1]]);
  }

  return {
    type: 'Polygon',
    coordinates: [ring as Position[]],
  };
}

export function createThermometerStartIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'thermometer-marker thermometer-marker--start',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="thermometer-marker__dot" style="--marker-color: ${color}">A</span>`,
  });
}

export function createThermometerEndIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'thermometer-marker thermometer-marker--end',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="thermometer-marker__dot" style="--marker-color: ${color}">B</span>`,
  });
}
