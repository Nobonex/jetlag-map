import { Injectable } from '@angular/core';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import * as L from 'leaflet';

import {
  WORLD_MAP_DEFAULT_BOUNDS,
  WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT,
  WORLD_MAP_HEADER_HEIGHT,
  WORLD_MAP_MAX_BOUNDS,
  WORLD_MAP_MAX_SELECTION_ZOOM,
} from '../constants/world-map.constants';
import type { RadarQuestion } from '../models/radar-question.model';
import { buildOutsideMask, intersectGeometry, subtractGeometry } from '../utils/map-mask.util';
import {
  createCirclePolygon,
  createRadarMarkerIcon,
  getRadarQuestionBounds,
  toPolygonFeatureCollection,
} from '../utils/geometry.util';

const MAP_PATH_SMOOTH_FACTOR = 0.2;
const MAX_RADAR_PLAYABLE_AREA_ZOOM = 9;

@Injectable({ providedIn: 'root' })
export class WorldMapRendererService {
  private map?: L.Map;
  private allCountriesLayer?: L.GeoJSON;
  private activeCountryLayer?: L.LayerGroup;
  private radarLayer?: L.LayerGroup;
  private suppressNextMapFit = false;

  initializeMap(container: HTMLElement): void {
    if (this.map) {
      return;
    }

    this.map = L.map(container, {
      zoomControl: false,
      minZoom: 2,
      preferCanvas: true,
      maxBounds: WORLD_MAP_MAX_BOUNDS,
      maxBoundsViscosity: 1,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      noWrap: true,
    }).addTo(this.map);
  }

  destroyMap(): void {
    this.map?.remove();
    this.map = undefined;
  }

  invalidateSize(): void {
    this.map?.invalidateSize();
  }

  suppressNextFit(): void {
    this.suppressNextMapFit = true;
  }

  renderMapState(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null,
    worldFeatureCollection: FeatureCollection<Polygon | MultiPolygon>,
    radarQuestions: RadarQuestion[],
    headerHeight: number,
    onQuestionDragEnd?: (questionId: string, center: { lat: number; lng: number }) => void,
  ): void {
    if (!this.map) {
      return;
    }

    const shouldFitMap = !this.suppressNextMapFit;
    this.suppressNextMapFit = false;

    this.allCountriesLayer?.removeFrom(this.map);
    this.activeCountryLayer?.removeFrom(this.map);
    this.radarLayer?.removeFrom(this.map);

    if (!activeCountryGeometry) {
      if (worldFeatureCollection.features.length > 0) {
        this.allCountriesLayer = L.geoJSON(worldFeatureCollection, {
          style: () => ({
            color: '#4f6578',
            weight: 0.7,
            opacity: 0.28,
            fill: false,
          }),
          interactive: false,
        }).addTo(this.map);
      }

      this.renderRadarLayer(null, radarQuestions, onQuestionDragEnd);
      if (shouldFitMap) {
        this.fitBounds(this.getRadarQuestionsBounds(radarQuestions) ?? WORLD_MAP_DEFAULT_BOUNDS, undefined, headerHeight);
      }
      return;
    }

    this.allCountriesLayer = L.geoJSON(buildOutsideMask(activeCountryGeometry), {
      style: () => ({
        stroke: false,
        fillColor: '#d2dae1',
        fillOpacity: 0.68,
        fillRule: 'evenodd',
      }),
      interactive: false,
      smoothFactor: MAP_PATH_SMOOTH_FACTOR,
    } as L.GeoJSONOptions & L.PolylineOptions).addTo(this.map);

    const activeOutlineLayer = L.geoJSON(activeCountryGeometry, {
      style: () => ({
        color: '#19364d',
        weight: 2.2,
        opacity: 0.96,
        fill: false,
      }),
      interactive: false,
      smoothFactor: MAP_PATH_SMOOTH_FACTOR,
    } as L.GeoJSONOptions & L.PolylineOptions);

    this.activeCountryLayer = L.layerGroup([activeOutlineLayer]).addTo(this.map);
    this.renderRadarLayer(activeCountryGeometry, radarQuestions, onQuestionDragEnd);

    const playableAreaBounds = this.getPlayableAreaBounds(activeCountryGeometry, radarQuestions);
    if (shouldFitMap) {
      this.fitBounds(
        playableAreaBounds ?? activeOutlineLayer.getBounds(),
        playableAreaBounds ? MAX_RADAR_PLAYABLE_AREA_ZOOM : WORLD_MAP_MAX_SELECTION_ZOOM,
        headerHeight,
      );
    }
  }

  fitBounds(bounds: L.LatLngBounds, maxZoom: number | undefined, headerHeight: number): void {
    this.map?.fitBounds(bounds, {
      paddingTopLeft: L.point(24, headerHeight + 24),
      paddingBottomRight: WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT,
      maxZoom,
    });
  }

  mouseEventToLatLng(event: MouseEvent | PointerEvent): L.LatLng | null {
    return this.map?.mouseEventToLatLng(event) ?? null;
  }

  getMap(): L.Map | undefined {
    return this.map;
  }

  private renderRadarLayer(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null,
    questions: RadarQuestion[],
    onQuestionDragEnd?: (questionId: string, center: { lat: number; lng: number }) => void,
  ): void {
    if (!this.map || questions.length === 0) {
      return;
    }

    const radarLayers: L.Layer[] = [];

    if (activeCountryGeometry) {
      const playableArea = this.buildPlayableArea(activeCountryGeometry, questions);
      if (playableArea && playableArea.features.length > 0) {
        const radarMask = subtractGeometry(activeCountryGeometry, playableArea);
        if (radarMask.features.length > 0) {
          radarLayers.push(
            L.geoJSON(radarMask, {
              style: () => ({
                stroke: false,
                fillColor: '#d2dae1',
                fillOpacity: 0.68,
              }),
              interactive: false,
              smoothFactor: MAP_PATH_SMOOTH_FACTOR,
            } as L.GeoJSONOptions & L.PolylineOptions),
          );
        }
      }
    }

    for (const question of questions) {
      const center = L.latLng(question.center.lat, question.center.lng);
      const radiusMeters = question.applied.radiusKm * 1000;

      const radarCircle = L.circle(center, {
        radius: radiusMeters,
        color: question.color,
        weight: 2,
        opacity: 0.95,
        fillColor: question.color,
        fillOpacity: 0,
        interactive: false,
      });

      const radarMarker = L.marker(center, {
        draggable: !question.isLocked,
        icon: createRadarMarkerIcon(question.color),
      });

      if (!question.isLocked && onQuestionDragEnd) {
        radarMarker.on('drag', () => {
          radarCircle.setLatLng(radarMarker.getLatLng());
        });

        radarMarker.on('dragend', () => {
          const nextCenter = radarMarker.getLatLng();
          onQuestionDragEnd(question.id, { lat: nextCenter.lat, lng: nextCenter.lng });
        });
      }

      radarLayers.push(radarCircle, radarMarker);
    }

    this.radarLayer = L.layerGroup(radarLayers).addTo(this.map);
  }

  private buildPlayableArea(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>,
    questions: RadarQuestion[],
  ): FeatureCollection<Polygon> | null {
    if (questions.length === 0) {
      return null;
    }

    let playableArea = toPolygonFeatureCollection(activeCountryGeometry);

    for (const question of questions) {
      const radarArea = {
        type: 'Feature' as const,
        properties: {},
        geometry: createCirclePolygon(L.latLng(question.center.lat, question.center.lng), question.applied.radiusKm * 1000),
      };

      playableArea =
        question.applied.mode === 'inside'
          ? intersectGeometry(playableArea, radarArea)
          : subtractGeometry(playableArea, radarArea);

      if (playableArea.features.length === 0) {
        return playableArea;
      }
    }

    return playableArea;
  }

  private getPlayableAreaBounds(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>,
    questions: RadarQuestion[],
  ): L.LatLngBounds | null {
    const playableArea = this.buildPlayableArea(activeCountryGeometry, questions);
    if (!playableArea || playableArea.features.length === 0) {
      return null;
    }

    const bounds = L.geoJSON(playableArea).getBounds();
    return bounds.isValid() ? bounds : null;
  }

  private getRadarQuestionsBounds(questions: RadarQuestion[]): L.LatLngBounds | null {
    if (questions.length === 0) {
      return null;
    }

    const [firstQuestion, ...remainingQuestions] = questions;
    const bounds = getRadarQuestionBounds(firstQuestion);

    for (const question of remainingQuestions) {
      bounds.extend(getRadarQuestionBounds(question));
    }

    return bounds;
  }
}
