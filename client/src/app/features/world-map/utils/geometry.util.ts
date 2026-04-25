import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import * as L from 'leaflet';

import type { RadarQuestion } from '../models/radar-question.model';

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
