import { describe, expect, it } from 'vitest';
import * as L from 'leaflet';
import { intersectGeometry } from './map-mask.util';

import {
  createThermometerAreaPolygon,
  getBisectorPath,
  getBisectorEdgePoints,
  getBisectorPoints,
  getBoundingBox,
  normalizeLongitude,
} from './geometry.util';

function toProjectedPoint(lng: number, lat: number): { x: number; y: number } {
  const projected = L.CRS.EPSG3857.project(L.latLng(lat, lng));
  return { x: projected.x, y: projected.y };
}

function getProjectedMidpoint(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): { lat: number; lng: number } {
  const projectedStart = toProjectedPoint(start.lng, start.lat);
  const projectedEnd = toProjectedPoint(end.lng, end.lat);
  const midpoint = L.CRS.EPSG3857.unproject(
    L.point(
      (projectedStart.x + projectedEnd.x) / 2,
      (projectedStart.y + projectedEnd.y) / 2,
    ),
  );

  return { lat: midpoint.lat, lng: midpoint.lng };
}

function createProjectedLocalBbox(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const projectedStart = L.CRS.EPSG3857.project(L.latLng(start.lat, start.lng));
  const projectedEnd = L.CRS.EPSG3857.project(L.latLng(end.lat, end.lng));
  const projectedMid = L.point(
    (projectedStart.x + projectedEnd.x) / 2,
    (projectedStart.y + projectedEnd.y) / 2,
  );
  const localExtentMeters = Math.max(projectedStart.distanceTo(projectedEnd) * 0.75, 30000);
  const southWest = L.CRS.EPSG3857.unproject(
    L.point(projectedMid.x - localExtentMeters, projectedMid.y - localExtentMeters),
  );
  const northEast = L.CRS.EPSG3857.unproject(
    L.point(projectedMid.x + localExtentMeters, projectedMid.y + localExtentMeters),
  );

  return {
    minLng: southWest.lng,
    maxLng: northEast.lng,
    minLat: southWest.lat,
    maxLat: northEast.lat,
  };
}

function projectedBisectorDot(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const projectedStart = toProjectedPoint(start.lng, start.lat);
  const projectedEnd = toProjectedPoint(end.lng, end.lat);
  const projectedPoint = toProjectedPoint(point.lng, point.lat);
  const midpoint = {
    x: (projectedStart.x + projectedEnd.x) / 2,
    y: (projectedStart.y + projectedEnd.y) / 2,
  };

  return (
    (projectedEnd.x - projectedStart.x) * (projectedPoint.x - midpoint.x) +
    (projectedEnd.y - projectedStart.y) * (projectedPoint.y - midpoint.y)
  );
}

describe('getBoundingBox', () => {
  it('computes bounds for a single Polygon feature', () => {
    const geometry = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [10, 20],
                [30, 20],
                [30, 40],
                [10, 40],
                [10, 20],
              ],
            ],
          },
        },
      ],
    };

    const bbox = getBoundingBox(geometry);

    expect(bbox.minLng).toBe(10);
    expect(bbox.maxLng).toBe(30);
    expect(bbox.minLat).toBe(20);
    expect(bbox.maxLat).toBe(40);
  });

  it('computes bounds across multiple Polygon features', () => {
    const geometry = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [20, 30],
                [40, 30],
                [40, 50],
                [20, 50],
                [20, 30],
              ],
            ],
          },
        },
      ],
    };

    const bbox = getBoundingBox(geometry);

    expect(bbox.minLng).toBe(0);
    expect(bbox.maxLng).toBe(40);
    expect(bbox.minLat).toBe(0);
    expect(bbox.maxLat).toBe(50);
  });

  it('computes bounds for a MultiPolygon feature', () => {
    const geometry = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'MultiPolygon' as const,
            coordinates: [
              [
                [
                  [-5, -5],
                  [5, -5],
                  [5, 5],
                  [-5, 5],
                  [-5, -5],
                ],
              ],
              [
                [
                  [15, 15],
                  [25, 15],
                  [25, 25],
                  [15, 25],
                  [15, 15],
                ],
              ],
            ],
          },
        },
      ],
    };

    const bbox = getBoundingBox(geometry);

    expect(bbox.minLng).toBe(-5);
    expect(bbox.maxLng).toBe(25);
    expect(bbox.minLat).toBe(-5);
    expect(bbox.maxLat).toBe(25);
  });
});

describe('createThermometerAreaPolygon', () => {
  const testBbox = { minLng: -10, maxLng: 20, minLat: -10, maxLat: 20 };

  it('returns a valid closed Polygon', () => {
    const polygon = createThermometerAreaPolygon(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      'warmer',
      testBbox,
    );

    expect(polygon.type).toBe('Polygon');
    expect(polygon.coordinates).toHaveLength(1);
    expect(polygon.coordinates[0].length).toBeGreaterThanOrEqual(3);
    const first = polygon.coordinates[0][0];
    const last = polygon.coordinates[0][polygon.coordinates[0].length - 1];
    expect(first).toEqual(last);
  });

  it('places the playable side on the end marker for warmer mode', () => {
    // Horizontal thermometer: start at (0,0), end at (0,10)
    // Bisector is vertical at lng=5.
    // Warmer means east side (lng > 5) is playable.
    const polygon = createThermometerAreaPolygon(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      'warmer',
      testBbox,
    );
    const ring = polygon.coordinates[0];
    const lngs = ring.map((p) => p[0]);

    // Polygon is bounded by the bbox
    expect(Math.min(...lngs)).toBeGreaterThanOrEqual(testBbox.minLng);
    expect(Math.max(...lngs)).toBeLessThanOrEqual(testBbox.maxLng);

    // The east-side playable region should reach the bbox eastern edge
    expect(Math.max(...lngs)).toBeGreaterThan(5);
  });

  it('places the playable side on the start marker for colder mode', () => {
    const polygon = createThermometerAreaPolygon(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      'colder',
      testBbox,
    );
    const ring = polygon.coordinates[0];
    const lngs = ring.map((p) => p[0]);

    // Polygon is bounded by the bbox
    expect(Math.min(...lngs)).toBeGreaterThanOrEqual(testBbox.minLng);
    expect(Math.max(...lngs)).toBeLessThanOrEqual(testBbox.maxLng);

    // The west-side playable region should reach the bbox western edge
    expect(Math.min(...lngs)).toBeLessThan(5);
  });

  it('handles diagonal thermometers (A at 11 o-clock to B)', () => {
    // A above-left of B: vector AB goes down-right
    const polygon = createThermometerAreaPolygon(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      'warmer',
      testBbox,
    );

    expect(polygon.coordinates[0].length).toBeGreaterThanOrEqual(3);
    const first = polygon.coordinates[0][0];
    const last = polygon.coordinates[0][polygon.coordinates[0].length - 1];
    expect(first).toEqual(last);

    // The polygon should be bounded by the bbox
    const lngs = polygon.coordinates[0].map((p) => p[0]);
    const lats = polygon.coordinates[0].map((p) => p[1]);
    expect(Math.min(...lngs)).toBeGreaterThanOrEqual(testBbox.minLng);
    expect(Math.max(...lngs)).toBeLessThanOrEqual(testBbox.maxLng);
    expect(Math.min(...lats)).toBeGreaterThanOrEqual(testBbox.minLat);
    expect(Math.max(...lats)).toBeLessThanOrEqual(testBbox.maxLat);
  });

  it('returns the full bbox when the bisector does not intersect it', () => {
    // Markers far west of the bbox; the entire bbox is on the warmer side
    const polygon = createThermometerAreaPolygon(
      { lat: 0, lng: -100 },
      { lat: 0, lng: -90 },
      'warmer',
      testBbox,
    );

    const ring = polygon.coordinates[0];
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);

    expect(Math.min(...lngs)).toBeCloseTo(testBbox.minLng, 10);
    expect(Math.max(...lngs)).toBeCloseTo(testBbox.maxLng, 10);
    expect(Math.min(...lats)).toBeCloseTo(testBbox.minLat, 10);
    expect(Math.max(...lats)).toBeCloseTo(testBbox.maxLat, 10);
  });

  it('returns an empty ring when the playable side is outside the bbox', () => {
    const polygon = createThermometerAreaPolygon(
      { lat: 0, lng: -100 },
      { lat: 0, lng: -90 },
      'colder',
      testBbox,
    );

    expect(polygon.coordinates[0].length).toBe(0);
  });

  it('always produces counter-clockwise exterior rings', () => {
    function signedArea(ring: number[][]): number {
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      return area;
    }

    const warmer = createThermometerAreaPolygon(
      { lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 'warmer', testBbox,
    );
    const colder = createThermometerAreaPolygon(
      { lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 'colder', testBbox,
    );

    expect(signedArea(warmer.coordinates[0])).toBeGreaterThan(0);
    expect(signedArea(colder.coordinates[0])).toBeGreaterThan(0);
  });

  it('uses the exact bisector path as part of the polygon boundary', () => {
    const start = { lat: 48.8566, lng: 2.3522 };
    const end = { lat: 45.764, lng: 4.8357 };
    const bbox = { minLng: -2, maxLng: 8, minLat: 42, maxLat: 52 };
    const polygon = createThermometerAreaPolygon(start, end, 'warmer', bbox);
    const path = getBisectorPath(start, end, bbox);
    const ring = polygon.coordinates[0];

    for (const [lng, lat] of path) {
      const matches = ring.some(
        ([ringLng, ringLat]) => Math.abs(ringLng - lng) < 1e-9 && Math.abs(ringLat - lat) < 1e-9,
      );
      expect(matches).toBe(true);
    }
  });

  it('does not produce multiple gray areas when B is top-left of A', () => {
    const start = { lat: 51.91, lng: 4.52 };
    const end = { lat: 52.01, lng: 4.38 };
    const bbox = { minLng: 4.2, maxLng: 4.7, minLat: 51.8, maxLat: 52.1 };
    const polygon = createThermometerAreaPolygon(start, end, 'warmer', bbox);
    const country = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [bbox.minLng, bbox.minLat],
              [bbox.maxLng, bbox.minLat],
              [bbox.maxLng, bbox.maxLat],
              [bbox.minLng, bbox.maxLat],
              [bbox.minLng, bbox.minLat],
            ]],
          },
        },
      ],
    };

    const clipped = intersectGeometry(country, {
      type: 'Feature',
      properties: {},
      geometry: polygon,
    });

    expect(clipped.features).toHaveLength(1);
  });
});

describe('getBisectorPoints', () => {
  it('returns two points on the perpendicular bisector', () => {
    const { p1, p2 } = getBisectorPoints({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 5);

    // Bisector should be vertical for a horizontal thermometer
    expect(p1[0]).toBe(p2[0]);
    expect(p1[0]).toBe(5); // midpoint lng

    // Points should be extent units apart in latitude
    expect(Math.abs(p2[1] - p1[1])).toBe(10);
  });

  it('returns a horizontal bisector for vertical thermometers', () => {
    const { p1, p2 } = getBisectorPoints({ lat: 0, lng: 5 }, { lat: 10, lng: 5 }, 5);

    // Bisector should be horizontal for a vertical thermometer
    expect(p1[1]).toBe(p2[1]);
    expect(p1[1]).toBe(5); // midpoint lat

    // Points should be extent units apart in longitude
    expect(Math.abs(p2[0] - p1[0])).toBe(10);
  });
});

describe('getBisectorEdgePoints', () => {
  const testBbox = { minLng: -10, maxLng: 20, minLat: -10, maxLat: 20 };

  it('returns points on opposite bbox edges for a horizontal thermometer', () => {
    // Horizontal: bisector is vertical at lng = 5
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      testBbox,
    );

    // Bisector should hit the top and bottom edges
    expect(p1[0]).toBeCloseTo(p2[0], 10);
    expect(p1[0]).toBeCloseTo(5, 10);
    const lats = [p1[1], p2[1]].sort((a, b) => a - b);
    expect(lats[0]).toBeCloseTo(testBbox.minLat, 10);
    expect(lats[1]).toBeCloseTo(testBbox.maxLat, 10);
  });

  it('returns points on opposite bbox edges for a vertical thermometer', () => {
    // Vertical: bisector is horizontal at lat = 5
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 0, lng: 5 },
      { lat: 10, lng: 5 },
      testBbox,
    );

    const projectedMidpoint = getProjectedMidpoint(
      { lat: 0, lng: 5 },
      { lat: 10, lng: 5 },
    );

    expect(p1[1]).toBeCloseTo(p2[1], 10);
    expect(p1[1]).toBeCloseTo(projectedMidpoint.lat, 10);
    const lngs = [p1[0], p2[0]].sort((a, b) => a - b);
    expect(lngs[0]).toBeCloseTo(testBbox.minLng, 10);
    expect(lngs[1]).toBeCloseTo(testBbox.maxLng, 10);
  });

  it('passes through the midpoint for diagonal thermometers', () => {
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      testBbox,
    );

    expect(Math.abs(projectedBisectorDot(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: p1[1], lng: p1[0] },
    ))).toBeLessThan(1e-2);
    expect(Math.abs(projectedBisectorDot(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: p2[1], lng: p2[0] },
    ))).toBeLessThan(1e-2);

    const projectedMidpoint = getProjectedMidpoint(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
    );
    expect(Math.abs(projectedBisectorDot(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      projectedMidpoint,
    ))).toBeLessThan(1e-2);
  });

  it('keeps returned points inside the bbox', () => {
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 5, lng: 5 },
      { lat: 7, lng: 8 },
      testBbox,
    );

    for (const [lng, lat] of [p1, p2]) {
      expect(lng).toBeGreaterThanOrEqual(testBbox.minLng - 1e-9);
      expect(lng).toBeLessThanOrEqual(testBbox.maxLng + 1e-9);
      expect(lat).toBeGreaterThanOrEqual(testBbox.minLat - 1e-9);
      expect(lat).toBeLessThanOrEqual(testBbox.maxLat + 1e-9);
    }
  });

  it('produces a line that splits the thermometer polygon exactly in half', () => {
    const start = { lat: 10, lng: 0 };
    const end = { lat: 0, lng: 10 };

    const bisector = getBisectorEdgePoints(start, end, testBbox);
    const polygon = createThermometerAreaPolygon(start, end, 'warmer', testBbox);
    const ring = polygon.coordinates[0];

    // The bisector line should pass through two vertices of the polygon ring
    // (the two interpolated edge-crossing points)
    const onBisector = (lng: number, lat: number): boolean =>
      Math.abs(projectedBisectorDot(start, end, { lat, lng })) < 1e-2;

    const bisectorVertices = ring.filter(([lng, lat]) => onBisector(lng, lat));
    expect(bisectorVertices.length).toBeGreaterThanOrEqual(2);

    // The bisector line endpoints should match two of those vertices
    const matchesP1 = bisectorVertices.some(
      ([lng, lat]) => Math.abs(lng - bisector.p1[0]) < 1e-6 && Math.abs(lat - bisector.p1[1]) < 1e-6,
    );
    const matchesP2 = bisectorVertices.some(
      ([lng, lat]) => Math.abs(lng - bisector.p2[0]) < 1e-6 && Math.abs(lat - bisector.p2[1]) < 1e-6,
    );
    expect(matchesP1).toBe(true);
    expect(matchesP2).toBe(true);
  });

  it('stays centred and perpendicular for close diagonal points', () => {
    const start = { lat: 51.9225, lng: 4.47917 };
    const end = { lat: 51.935, lng: 4.455 };
    const bbox = createProjectedLocalBbox(start, end);
    const { p1, p2 } = getBisectorEdgePoints(start, end, bbox);

    const projectedStart = toProjectedPoint(start.lng, start.lat);
    const projectedEnd = toProjectedPoint(end.lng, end.lat);
    const projectedP1 = toProjectedPoint(p1[0], p1[1]);
    const projectedP2 = toProjectedPoint(p2[0], p2[1]);
    const midpoint = {
      x: (projectedStart.x + projectedEnd.x) / 2,
      y: (projectedStart.y + projectedEnd.y) / 2,
    };
    const bisectorMid = {
      x: (projectedP1.x + projectedP2.x) / 2,
      y: (projectedP1.y + projectedP2.y) / 2,
    };
    const ab = {
      x: projectedEnd.x - projectedStart.x,
      y: projectedEnd.y - projectedStart.y,
    };
    const bisector = {
      x: projectedP2.x - projectedP1.x,
      y: projectedP2.y - projectedP1.y,
    };

    expect(Math.abs(midpoint.x - bisectorMid.x)).toBeLessThan(1);
    expect(Math.abs(midpoint.y - bisectorMid.y)).toBeLessThan(1);
    expect(Math.abs(ab.x * bisector.x + ab.y * bisector.y)).toBeLessThan(1e-2);
  });
});

describe('normalizeLongitude', () => {
  it('keeps values inside (-180, 180) unchanged', () => {
    expect(normalizeLongitude(0)).toBe(0);
    expect(normalizeLongitude(45)).toBe(45);
    expect(normalizeLongitude(-45)).toBe(-45);
  });

  it('maps 180 and -180 to the same meridian (-180)', () => {
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(-180)).toBe(-180);
  });

  it('wraps values above 180', () => {
    expect(normalizeLongitude(190)).toBe(-170);
    expect(normalizeLongitude(360)).toBe(0);
    expect(normalizeLongitude(540)).toBe(-180);
    expect(normalizeLongitude(720)).toBe(0);
  });

  it('wraps values below -180', () => {
    expect(normalizeLongitude(-190)).toBe(170);
    expect(normalizeLongitude(-360)).toBe(0);
    expect(normalizeLongitude(-540)).toBe(-180);
    expect(normalizeLongitude(-720)).toBe(0);
  });
});
