import { describe, expect, it } from 'vitest';

import {
  createThermometerAreaPolygon,
  getBisectorEdgePoints,
  getBisectorPoints,
  getBoundingBox,
  normalizeLongitude,
} from './geometry.util';

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

    expect(Math.min(...lngs)).toBe(testBbox.minLng);
    expect(Math.max(...lngs)).toBe(testBbox.maxLng);
    expect(Math.min(...lats)).toBe(testBbox.minLat);
    expect(Math.max(...lats)).toBe(testBbox.maxLat);
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
    expect(p1[0]).toBe(p2[0]);
    expect(p1[0]).toBe(5);
    const lats = [p1[1], p2[1]].sort((a, b) => a - b);
    expect(lats[0]).toBe(testBbox.minLat);
    expect(lats[1]).toBe(testBbox.maxLat);
  });

  it('returns points on opposite bbox edges for a vertical thermometer', () => {
    // Vertical: bisector is horizontal at lat = 5
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 0, lng: 5 },
      { lat: 10, lng: 5 },
      testBbox,
    );

    expect(p1[1]).toBe(p2[1]);
    expect(p1[1]).toBe(5);
    const lngs = [p1[0], p2[0]].sort((a, b) => a - b);
    expect(lngs[0]).toBe(testBbox.minLng);
    expect(lngs[1]).toBe(testBbox.maxLng);
  });

  it('passes through the midpoint for diagonal thermometers', () => {
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 10, lng: 0 },
      { lat: 0, lng: 10 },
      testBbox,
    );

    const midLng = 5;
    const midLat = 5;

    // The midpoint should lie on the segment p1->p2 (within tolerance)
    const t = (midLng - p1[0]) / (p2[0] - p1[0]);
    const latOnLine = p1[1] + t * (p2[1] - p1[1]);
    expect(Math.abs(latOnLine - midLat)).toBeLessThan(1e-10);
  });

  it('keeps returned points inside the bbox', () => {
    const { p1, p2 } = getBisectorEdgePoints(
      { lat: 5, lng: 5 },
      { lat: 7, lng: 8 },
      testBbox,
    );

    for (const [lng, lat] of [p1, p2]) {
      expect(lng).toBeGreaterThanOrEqual(testBbox.minLng);
      expect(lng).toBeLessThanOrEqual(testBbox.maxLng);
      expect(lat).toBeGreaterThanOrEqual(testBbox.minLat);
      expect(lat).toBeLessThanOrEqual(testBbox.maxLat);
    }
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
