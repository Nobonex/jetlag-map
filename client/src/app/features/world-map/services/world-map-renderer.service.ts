import { Injectable } from '@angular/core';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import * as L from 'leaflet';

import {
  WORLD_MAP_DEFAULT_BOUNDS,
  WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT,
  WORLD_MAP_MAX_BOUNDS,
  WORLD_MAP_MAX_SELECTION_ZOOM,
} from '../constants/world-map.constants';
import type { GameQuestion } from '../models/radar-question.model';
import { isRadarQuestion, isThermometerQuestion } from '../models/radar-question.model';
import { buildOutsideMask, intersectGeometry, subtractGeometry } from '../utils/map-mask.util';
import {
  createCirclePolygon,
  createRadarMarkerIcon,
  createThermometerAreaPolygon,
  createThermometerEndIcon,
  createThermometerStartIcon,
  getBisectorPoints,
  getBoundingBox,
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
  private questionLayer?: L.LayerGroup;

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

  renderMapState(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null,
    worldFeatureCollection: FeatureCollection<Polygon | MultiPolygon>,
    questions: GameQuestion[],
    headerHeight: number,
    shouldFitMap: boolean,
    onQuestionDragEnd?: (
      questionId: string,
      point: { lat: number; lng: number },
      which: 'center' | 'start' | 'end',
    ) => void,
  ): void {
    if (!this.map) {
      return;
    }

    this.allCountriesLayer?.removeFrom(this.map);
    this.activeCountryLayer?.removeFrom(this.map);
    this.questionLayer?.removeFrom(this.map);

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

      this.renderQuestionLayer(null, questions, onQuestionDragEnd);
      if (shouldFitMap) {
        this.fitBounds(this.getQuestionsBounds(questions) ?? WORLD_MAP_DEFAULT_BOUNDS, undefined, headerHeight);
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
    this.renderQuestionLayer(activeCountryGeometry, questions, onQuestionDragEnd);

    const playableAreaBounds = this.getPlayableAreaBounds(activeCountryGeometry, questions);
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

  private renderQuestionLayer(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null,
    questions: GameQuestion[],
    onQuestionDragEnd?: (
      questionId: string,
      point: { lat: number; lng: number },
      which: 'center' | 'start' | 'end',
    ) => void,
  ): void {
    if (!this.map || questions.length === 0) {
      return;
    }

    const layers: L.Layer[] = [];

    if (activeCountryGeometry) {
      const playableArea = this.buildPlayableArea(activeCountryGeometry, questions);
      if (playableArea && playableArea.features.length > 0) {
        const mask = subtractGeometry(activeCountryGeometry, playableArea);
        if (mask.features.length > 0) {
          layers.push(
            L.geoJSON(mask, {
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
      if (isRadarQuestion(question)) {
        this.renderRadarQuestion(layers, question, onQuestionDragEnd);
      } else if (isThermometerQuestion(question)) {
        this.renderThermometerQuestion(layers, question, onQuestionDragEnd);
      }
    }

    this.questionLayer = L.layerGroup(layers).addTo(this.map);
  }

  private renderRadarQuestion(
    layers: L.Layer[],
    question: import('../models/radar-question.model').RadarQuestion,
    onQuestionDragEnd?: (
      questionId: string,
      point: { lat: number; lng: number },
      which: 'center' | 'start' | 'end',
    ) => void,
  ): void {
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
        onQuestionDragEnd(question.id, { lat: nextCenter.lat, lng: nextCenter.lng }, 'center');
      });
    }

    layers.push(radarCircle, radarMarker);
  }

  private renderThermometerQuestion(
    layers: L.Layer[],
    question: import('../models/thermometer-question.model').ThermometerQuestion,
    onQuestionDragEnd?: (
      questionId: string,
      point: { lat: number; lng: number },
      which: 'center' | 'start' | 'end',
    ) => void,
  ): void {
    const start = L.latLng(question.start.lat, question.start.lng);
    const end = L.latLng(question.end.lat, question.end.lng);

    // Draw line between start and end
    const line = L.polyline([start, end], {
      color: question.color,
      weight: 2,
      opacity: 0.95,
      interactive: false,
    });

    // Draw perpendicular bisector so users can see the division line
    const bisector = getBisectorPoints(question.start, question.end, 10);
    const bisectorLine = L.polyline(
      [L.latLng(bisector.p1[1], bisector.p1[0]), L.latLng(bisector.p2[1], bisector.p2[0])],
      {
        color: question.color,
        weight: 2,
        opacity: 0.6,
        dashArray: '6, 6',
        interactive: false,
      },
    );

    // Start marker (A)
    const startMarker = L.marker(start, {
      draggable: !question.isLocked,
      icon: createThermometerStartIcon(question.color),
    });

    // End marker (B)
    const endMarker = L.marker(end, {
      draggable: !question.isLocked,
      icon: createThermometerEndIcon(question.color),
    });

    if (!question.isLocked && onQuestionDragEnd) {
      const updateBisector = (): void => {
        const s = startMarker.getLatLng();
        const e = endMarker.getLatLng();
        const nextBisector = getBisectorPoints(
          { lat: s.lat, lng: s.lng },
          { lat: e.lat, lng: e.lng },
          10,
        );
        bisectorLine.setLatLngs([
          L.latLng(nextBisector.p1[1], nextBisector.p1[0]),
          L.latLng(nextBisector.p2[1], nextBisector.p2[0]),
        ]);
      };

      startMarker.on('drag', () => {
        line.setLatLngs([startMarker.getLatLng(), endMarker.getLatLng()]);
        updateBisector();
      });

      startMarker.on('dragend', () => {
        const nextCenter = startMarker.getLatLng();
        onQuestionDragEnd(question.id, { lat: nextCenter.lat, lng: nextCenter.lng }, 'start');
      });

      endMarker.on('drag', () => {
        line.setLatLngs([startMarker.getLatLng(), endMarker.getLatLng()]);
        updateBisector();
      });

      endMarker.on('dragend', () => {
        const nextCenter = endMarker.getLatLng();
        onQuestionDragEnd(question.id, { lat: nextCenter.lat, lng: nextCenter.lng }, 'end');
      });
    }

    layers.push(line, bisectorLine, startMarker, endMarker);
  }

  private buildPlayableArea(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>,
    questions: GameQuestion[],
  ): FeatureCollection<Polygon> | null {
    if (questions.length === 0) {
      return null;
    }

    let playableArea = toPolygonFeatureCollection(activeCountryGeometry);

    const hasThermometer = questions.some(isThermometerQuestion);
    const bbox = hasThermometer ? getBoundingBox(activeCountryGeometry) : null;

    for (const question of questions) {
      if (isRadarQuestion(question)) {
        const radarArea = {
          type: 'Feature' as const,
          properties: {},
          geometry: createCirclePolygon(
            L.latLng(question.center.lat, question.center.lng),
            question.applied.radiusKm * 1000,
          ),
        };

        playableArea =
          question.applied.mode === 'inside'
            ? intersectGeometry(playableArea, radarArea)
            : subtractGeometry(playableArea, radarArea);
      } else if (isThermometerQuestion(question)) {
        if (!bbox) {
          continue;
        }

        const thermometerArea = {
          type: 'Feature' as const,
          properties: {},
          geometry: createThermometerAreaPolygon(
            question.start,
            question.end,
            question.applied.mode,
            {
              minLng: bbox.minLng - 2,
              maxLng: bbox.maxLng + 2,
              minLat: bbox.minLat - 2,
              maxLat: bbox.maxLat + 2,
            },
          ),
        };

        playableArea = intersectGeometry(playableArea, thermometerArea);
      }

      if (playableArea.features.length === 0) {
        return playableArea;
      }
    }

    return playableArea;
  }

  private buildBboxFeature(
    geometry: FeatureCollection<Polygon | MultiPolygon>,
  ): Feature<Polygon> {
    const bbox = getBoundingBox(geometry);
    const margin = 2;

    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [bbox.minLng - margin, bbox.minLat - margin],
            [bbox.maxLng + margin, bbox.minLat - margin],
            [bbox.maxLng + margin, bbox.maxLat + margin],
            [bbox.minLng - margin, bbox.maxLat + margin],
            [bbox.minLng - margin, bbox.minLat - margin],
          ],
        ],
      },
    };
  }

  private getPlayableAreaBounds(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>,
    questions: GameQuestion[],
  ): L.LatLngBounds | null {
    const playableArea = this.buildPlayableArea(activeCountryGeometry, questions);
    if (!playableArea || playableArea.features.length === 0) {
      return null;
    }

    const bounds = L.geoJSON(playableArea).getBounds();
    return bounds.isValid() ? bounds : null;
  }

  private getQuestionsBounds(questions: GameQuestion[]): L.LatLngBounds | null {
    if (questions.length === 0) {
      return null;
    }

    let bounds: L.LatLngBounds | null = null;

    for (const question of questions) {
      if (isRadarQuestion(question)) {
        const questionBounds = getRadarQuestionBounds(question);
        if (!bounds) {
          bounds = questionBounds;
        } else {
          bounds.extend(questionBounds);
        }
      } else if (isThermometerQuestion(question)) {
        const start = L.latLng(question.start.lat, question.start.lng);
        const end = L.latLng(question.end.lat, question.end.lng);
        if (!bounds) {
          bounds = L.latLngBounds(start, end);
        } else {
          bounds.extend(start);
          bounds.extend(end);
        }
      }
    }

    return bounds;
  }
}
