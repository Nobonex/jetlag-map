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

type ProjectedPoint = { x: number; y: number };
type ProjectedBbox = { minX: number; maxX: number; minY: number; maxY: number };
const THERMOMETER_BISECTOR_SAMPLE_COUNT = 48;
type PerimeterDirection = 'ccw' | 'cw';

function projectPoint(point: { lat: number; lng: number }): ProjectedPoint {
  const projected = L.CRS.EPSG3857.project(L.latLng(point.lat, point.lng));
  return { x: projected.x, y: projected.y };
}

function unprojectPoint(point: ProjectedPoint): [number, number] {
  const unprojected = L.CRS.EPSG3857.unproject(L.point(point.x, point.y));
  return [normalizeLongitude(unprojected.lng), clamp(unprojected.lat, -90, 90)];
}

function projectBoundingBox(
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): ProjectedBbox {
  const southWest = projectPoint({ lat: bbox.minLat, lng: bbox.minLng });
  const northEast = projectPoint({ lat: bbox.maxLat, lng: bbox.maxLng });

  return {
    minX: Math.min(southWest.x, northEast.x),
    maxX: Math.max(southWest.x, northEast.x),
    minY: Math.min(southWest.y, northEast.y),
    maxY: Math.max(southWest.y, northEast.y),
  };
}

function getProjectedBisector(start: QuestionCenter, end: QuestionCenter): {
  mid: ProjectedPoint;
  ab: ProjectedPoint;
  direction: ProjectedPoint;
} {
  const projectedStart = projectPoint(start);
  const projectedEnd = projectPoint(end);
  const abX = projectedEnd.x - projectedStart.x;
  const abY = projectedEnd.y - projectedStart.y;
  const abLength = Math.hypot(abX, abY);

  if (abLength < 1e-9) {
    return {
      mid: projectedStart,
      ab: { x: 1, y: 0 },
      direction: { x: 0, y: 1 },
    };
  }

  return {
    mid: {
      x: (projectedStart.x + projectedEnd.x) / 2,
      y: (projectedStart.y + projectedEnd.y) / 2,
    },
    ab: { x: abX, y: abY },
    direction: { x: -abY, y: abX },
  };
}

function getProjectedBisectorEdgePoints(
  start: QuestionCenter,
  end: QuestionCenter,
  projectedBbox: ProjectedBbox,
): { p1: ProjectedPoint; p2: ProjectedPoint } {
  const bisector = getProjectedBisector(start, end);
  const ts: number[] = [];
  const EPS = 1e-9;

  if (Math.abs(bisector.direction.x) > EPS) {
    ts.push((projectedBbox.minX - bisector.mid.x) / bisector.direction.x);
    ts.push((projectedBbox.maxX - bisector.mid.x) / bisector.direction.x);
  }
  if (Math.abs(bisector.direction.y) > EPS) {
    ts.push((projectedBbox.minY - bisector.mid.y) / bisector.direction.y);
    ts.push((projectedBbox.maxY - bisector.mid.y) / bisector.direction.y);
  }

  const points = ts
    .map((t) => ({
      x: bisector.mid.x + t * bisector.direction.x,
      y: bisector.mid.y + t * bisector.direction.y,
      t,
    }))
    .filter(
      (point) =>
        point.x >= projectedBbox.minX - EPS &&
        point.x <= projectedBbox.maxX + EPS &&
        point.y >= projectedBbox.minY - EPS &&
        point.y <= projectedBbox.maxY + EPS,
    )
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) {
    const directionLength = Math.hypot(bisector.direction.x, bisector.direction.y) || 1;
    const extent = Math.max(
      projectedBbox.maxX - projectedBbox.minX,
      projectedBbox.maxY - projectedBbox.minY,
      1,
    );

    return {
      p1: {
        x: bisector.mid.x - (extent * bisector.direction.x) / directionLength,
        y: bisector.mid.y - (extent * bisector.direction.y) / directionLength,
      },
      p2: {
        x: bisector.mid.x + (extent * bisector.direction.x) / directionLength,
        y: bisector.mid.y + (extent * bisector.direction.y) / directionLength,
      },
    };
  }

  return {
    p1: { x: points[0].x, y: points[0].y },
    p2: { x: points[points.length - 1].x, y: points[points.length - 1].y },
  };
}

function sampleProjectedSegment(
  start: ProjectedPoint,
  end: ProjectedPoint,
  sampleCount: number,
): ProjectedPoint[] {
  const points: ProjectedPoint[] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    points.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
  }

  return points;
}

function pushPositionIfDistinct(target: Position[], next: Position): void {
  const previous = target[target.length - 1];
  if (previous && Math.abs(previous[0] - next[0]) < 1e-9 && Math.abs(previous[1] - next[1]) < 1e-9) {
    return;
  }

  target.push(next);
}

function getPerimeterSize(bbox: {
  minLng: number; maxLng: number; minLat: number; maxLat: number
}): number {
  const width = bbox.maxLng - bbox.minLng;
  const height = bbox.maxLat - bbox.minLat;
  return 2 * (width + height);
}

function getPerimeterPosition(
  point: Position,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): number {
  const [lng, lat] = point;
  const width = bbox.maxLng - bbox.minLng;
  const height = bbox.maxLat - bbox.minLat;
  const distances = [
    Math.abs(lat - bbox.minLat),
    Math.abs(lng - bbox.maxLng),
    Math.abs(lat - bbox.maxLat),
    Math.abs(lng - bbox.minLng),
  ];
  const edgeIndex = distances.indexOf(Math.min(...distances));

  switch (edgeIndex) {
    case 0:
      return lng - bbox.minLng;
    case 1:
      return width + (lat - bbox.minLat);
    case 2:
      return width + height + (bbox.maxLng - lng);
    default:
      return 2 * width + height + (bbox.maxLat - lat);
  }
}

function pointAtPerimeterPosition(
  position: number,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): Position {
  const width = bbox.maxLng - bbox.minLng;
  const height = bbox.maxLat - bbox.minLat;
  const perimeter = getPerimeterSize(bbox);
  const normalized = ((position % perimeter) + perimeter) % perimeter;

  if (normalized <= width) {
    return [bbox.minLng + normalized, bbox.minLat];
  }
  if (normalized <= width + height) {
    return [bbox.maxLng, bbox.minLat + (normalized - width)];
  }
  if (normalized <= 2 * width + height) {
    return [bbox.maxLng - (normalized - width - height), bbox.maxLat];
  }

  return [bbox.minLng, bbox.maxLat - (normalized - 2 * width - height)];
}

function getPerimeterArc(
  start: Position,
  end: Position,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  direction: PerimeterDirection,
): { points: Position[]; midpoint: Position } {
  const perimeter = getPerimeterSize(bbox);
  const startPosition = getPerimeterPosition(start, bbox);
  const endPosition = getPerimeterPosition(end, bbox);
  const travel = direction === 'ccw'
    ? ((endPosition - startPosition) % perimeter + perimeter) % perimeter
    : ((startPosition - endPosition) % perimeter + perimeter) % perimeter;
  const midpointPosition = direction === 'ccw'
    ? startPosition + travel / 2
    : startPosition - travel / 2;
  const points: Position[] = [];

  for (let index = 1; index < THERMOMETER_BISECTOR_SAMPLE_COUNT; index += 1) {
    const offset = (travel * index) / THERMOMETER_BISECTOR_SAMPLE_COUNT;
    const nextPosition = direction === 'ccw' ? startPosition + offset : startPosition - offset;
    pushPositionIfDistinct(points, pointAtPerimeterPosition(nextPosition, bbox));
  }

  return {
    points,
    midpoint: pointAtPerimeterPosition(midpointPosition, bbox),
  };
}

function signedArea(ring: Position[]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area;
}

function normalizeClosedRing(ring: Position[]): Position[] {
  const normalized: Position[] = [];
  for (const point of ring) {
    pushPositionIfDistinct(normalized, point);
  }

  if (normalized.length === 0) {
    return normalized;
  }

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (Math.abs(first[0] - last[0]) >= 1e-9 || Math.abs(first[1] - last[1]) >= 1e-9) {
    normalized.push(first);
  }

  if (signedArea(normalized) < 0) {
    const openRing = normalized.slice(0, -1).reverse();
    return [...openRing, openRing[0]];
  }

  return normalized;
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
  const intersections = getProjectedBisectorEdgePoints(start, end, projectBoundingBox(bbox));

  return {
    p1: unprojectPoint(intersections.p1),
    p2: unprojectPoint(intersections.p2),
  };
}

export function getBisectorPath(
  start: QuestionCenter,
  end: QuestionCenter,
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number },
): Position[] {
  const intersections = getProjectedBisectorEdgePoints(start, end, projectBoundingBox(bbox));
  return sampleProjectedSegment(intersections.p1, intersections.p2, THERMOMETER_BISECTOR_SAMPLE_COUNT).map(
    (point) => unprojectPoint(point),
  );
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
  const side = mode === 'warmer' ? 1 : -1;
  const EPS = 1e-10;
  const bisector = getProjectedBisector(start, end);
  const sideValue = (lng: number, lat: number): number => {
    const point = projectPoint({ lat, lng });
    return bisector.ab.x * (point.x - bisector.mid.x) + bisector.ab.y * (point.y - bisector.mid.y);
  };

  const isPlayable = (lng: number, lat: number): boolean => sideValue(lng, lat) * side >= -EPS;
  const bisectorPath = getBisectorPath(start, end, bbox);
  const corners: Position[] = [
    [bbox.minLng, bbox.minLat],
    [bbox.maxLng, bbox.minLat],
    [bbox.maxLng, bbox.maxLat],
    [bbox.minLng, bbox.maxLat],
  ];
  const playableCornerIndices = corners.flatMap((corner, index) =>
    isPlayable(corner[0], corner[1]) ? [index] : [],
  );

  if (playableCornerIndices.length === 0) {
    return { type: 'Polygon', coordinates: [[]] };
  }

  if (playableCornerIndices.length === 4) {
    return {
      type: 'Polygon',
      coordinates: [[...corners, corners[0]]],
    };
  }

  const pathStart = bisectorPath[0];
  const pathEnd = bisectorPath[bisectorPath.length - 1];
  const ccwArc = getPerimeterArc(pathEnd, pathStart, bbox, 'ccw');
  const cwArc = getPerimeterArc(pathEnd, pathStart, bbox, 'cw');
  const chosenArc = isPlayable(ccwArc.midpoint[0], ccwArc.midpoint[1]) ? ccwArc : cwArc;

  const ring = normalizeClosedRing([
    ...bisectorPath,
    ...chosenArc.points,
  ]);

  return {
    type: 'Polygon',
    coordinates: [ring],
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
