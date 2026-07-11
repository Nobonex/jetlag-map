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
import { isAreaQuestion, isRadarQuestion, isThermometerQuestion } from '../models/radar-question.model';
import { buildOutsideMask, intersectGeometry, subtractGeometry } from '../utils/map-mask.util';
import type { UserLocation } from './user-location.service';
import {
  createCirclePolygon,
  createAreaPolygon,
  createAreaVertexIcon,
  createRadarMarkerIcon,
  createThermometerAreaPolygon,
  createThermometerEndIcon,
  createThermometerStartIcon,
  getBisectorPath,
  getBoundingBox,
  getAreaQuestionBounds,
  getRadarQuestionBounds,
  toPolygonFeatureCollection,
} from '../utils/geometry.util';

const MAP_PATH_SMOOTH_FACTOR = 0.2;
const MAX_RADAR_PLAYABLE_AREA_ZOOM = 9;
type QuestionPoint = { lat: number; lng: number };
type QuestionPointKind = 'center' | 'start' | 'end' | number;

@Injectable({ providedIn: 'root' })
export class WorldMapRendererService {
  private map?: L.Map;
  private allCountriesLayer?: L.GeoJSON;
  private activeCountryLayer?: L.LayerGroup;
  private questionLayer?: L.LayerGroup;
  private userLocationLayer?: L.LayerGroup;
  private userLocationMarker?: L.Marker;
  private userLocationAccuracyCircle?: L.Circle;

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
    this.userLocationLayer = undefined;
    this.userLocationMarker = undefined;
    this.userLocationAccuracyCircle = undefined;
  }

  invalidateSize(): void {
    this.map?.invalidateSize();
  }

  showUserLocation(position: UserLocation): void {
    if (!this.map) {
      return;
    }

    const latLng = L.latLng(position.lat, position.lng);
    if (this.userLocationMarker && this.userLocationAccuracyCircle) {
      this.userLocationMarker.setLatLng(latLng);
      this.userLocationAccuracyCircle.setLatLng(latLng).setRadius(position.accuracyMeters);
      return;
    }

    this.userLocationAccuracyCircle = L.circle(latLng, {
      radius: position.accuracyMeters,
      color: '#1769aa',
      weight: 1,
      opacity: 0.55,
      fillColor: '#4da3e2',
      fillOpacity: 0.12,
      interactive: false,
    });
    this.userLocationMarker = L.marker(latLng, {
      interactive: false,
      zIndexOffset: 1000,
      icon: createUserLocationIcon(),
    });
    this.userLocationLayer = L.layerGroup([
      this.userLocationAccuracyCircle,
      this.userLocationMarker,
    ]).addTo(this.map);
  }

  clearUserLocation(): void {
    if (this.map && this.userLocationLayer) {
      this.userLocationLayer.removeFrom(this.map);
    }
    this.userLocationLayer = undefined;
    this.userLocationMarker = undefined;
    this.userLocationAccuracyCircle = undefined;
  }

  renderMapState(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null,
    worldFeatureCollection: FeatureCollection<Polygon | MultiPolygon>,
    questions: GameQuestion[],
    headerHeight: number,
    shouldFitMap: boolean,
    onQuestionDragEnd?: (
      questionId: string,
      point: QuestionPoint,
      which: QuestionPointKind,
    ) => void,
    onAreaClose?: (questionId: string) => void,
  ): void {
    if (!this.map) {
      return;
    }

    this.allCountriesLayer?.removeFrom(this.map);
    this.activeCountryLayer?.removeFrom(this.map);
    this.questionLayer?.removeFrom(this.map);

    const rawBbox = activeCountryGeometry ? getBoundingBox(activeCountryGeometry) : null;
    const expandedBbox = rawBbox
      ? {
          minLng: rawBbox.minLng - 2,
          maxLng: rawBbox.maxLng + 2,
          minLat: rawBbox.minLat - 2,
          maxLat: rawBbox.maxLat + 2,
        }
      : null;

    if (!activeCountryGeometry) {
      if (worldFeatureCollection.features.length > 0) {
        this.allCountriesLayer = L.geoJSON(worldFeatureCollection, {
          style: () => ({
            color: '#50665d',
            weight: 0.7,
            opacity: 0.28,
            fill: false,
          }),
          interactive: false,
        }).addTo(this.map);
      }

      this.renderQuestionLayer(null, questions, null, onQuestionDragEnd, onAreaClose);
      if (shouldFitMap) {
        this.fitBounds(this.getQuestionsBounds(questions) ?? WORLD_MAP_DEFAULT_BOUNDS, undefined, headerHeight);
      }
      return;
    }

    this.allCountriesLayer = L.geoJSON(buildOutsideMask(activeCountryGeometry), {
      style: () => ({
        stroke: false,
        fillColor: '#b9b6aa',
        fillOpacity: 0.64,
        fillRule: 'evenodd',
      }),
      interactive: false,
      smoothFactor: MAP_PATH_SMOOTH_FACTOR,
    } as L.GeoJSONOptions & L.PolylineOptions).addTo(this.map);

    const activeOutlineLayer = L.geoJSON(activeCountryGeometry, {
      style: () => ({
        color: '#183a33',
        weight: 2.2,
        opacity: 0.96,
        fill: false,
      }),
      interactive: false,
      smoothFactor: MAP_PATH_SMOOTH_FACTOR,
    } as L.GeoJSONOptions & L.PolylineOptions);

    this.activeCountryLayer = L.layerGroup([activeOutlineLayer]).addTo(this.map);
    this.renderQuestionLayer(activeCountryGeometry, questions, expandedBbox, onQuestionDragEnd, onAreaClose);

    const playableAreaBounds = this.getPlayableAreaBounds(activeCountryGeometry, questions, expandedBbox);
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
    thermometerBbox: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null,
    onQuestionDragEnd?: (
      questionId: string,
      point: QuestionPoint,
      which: QuestionPointKind,
    ) => void,
    onAreaClose?: (questionId: string) => void,
  ): void {
    if (!this.map || questions.length === 0) {
      return;
    }

    const layers: L.Layer[] = [];

    if (activeCountryGeometry) {
      const playableArea = this.buildPlayableArea(activeCountryGeometry, questions, thermometerBbox);
      if (playableArea && playableArea.features.length > 0) {
        const mask = subtractGeometry(activeCountryGeometry, playableArea);
        if (mask.features.length > 0) {
          layers.push(
            L.geoJSON(mask, {
              style: () => ({
                stroke: false,
                fillColor: '#b9b6aa',
                fillOpacity: 0.64,
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
        this.renderThermometerQuestion(layers, question, thermometerBbox, onQuestionDragEnd);
      } else if (isAreaQuestion(question)) {
        this.renderAreaQuestion(layers, question, onQuestionDragEnd, onAreaClose);
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
    thermometerBbox: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null,
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

    const createBisectorLatLngs = (
      startPoint: { lat: number; lng: number },
      endPoint: { lat: number; lng: number },
    ): L.LatLng[] => {
      const bbox = thermometerBbox ?? (() => {
        const projectedStart = L.CRS.EPSG3857.project(L.latLng(startPoint.lat, startPoint.lng));
        const projectedEnd = L.CRS.EPSG3857.project(L.latLng(endPoint.lat, endPoint.lng));
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
      })();

      return getBisectorPath(startPoint, endPoint, bbox).map(([lng, lat]) => L.latLng(lat, lng));
    };

    const bisectorLine = L.polyline(createBisectorLatLngs(question.start, question.end), {
      color: question.color,
      weight: 2,
      opacity: 0.6,
      dashArray: '6, 6',
      interactive: false,
    });

    // Small dot at the midpoint so the centre is unambiguous
    const midLat = (question.start.lat + question.end.lat) / 2;
    const midLng = (question.start.lng + question.end.lng) / 2;
    const midDot = L.circleMarker(L.latLng(midLat, midLng), {
      radius: 4,
      color: question.color,
      weight: 1,
      fillColor: question.color,
      fillOpacity: 0.8,
      interactive: false,
    });

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
        const nextMidLat = (s.lat + e.lat) / 2;
        const nextMidLng = (s.lng + e.lng) / 2;
        midDot.setLatLng(L.latLng(nextMidLat, nextMidLng));

        bisectorLine.setLatLngs(createBisectorLatLngs(
          { lat: s.lat, lng: s.lng },
          { lat: e.lat, lng: e.lng },
        ));
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

    layers.push(line, bisectorLine, midDot, startMarker, endMarker);
  }

  private renderAreaQuestion(
    layers: L.Layer[],
    question: import('../models/area-question.model').AreaQuestion,
    onQuestionDragEnd?: (
      questionId: string,
      point: QuestionPoint,
      which: QuestionPointKind,
    ) => void,
    onAreaClose?: (questionId: string) => void,
  ): void {
    const points = question.vertices.map((vertex) => L.latLng(vertex.lat, vertex.lng));
    const shape = question.isClosed
      ? L.polygon(points, {
          color: question.color,
          weight: 2.5,
          opacity: 0.95,
          fill: false,
          interactive: false,
        })
      : L.polyline(points, {
          color: question.color,
          weight: 2.5,
          opacity: 0.95,
          dashArray: '6, 5',
          interactive: false,
        });
    const canClose = !question.isClosed && !question.isLocked && question.vertices.length >= 3;
    const markers = points.map((point, index) => {
      const marker = L.marker(point, {
        draggable: !question.isLocked,
        bubblingMouseEvents: false,
        icon: createAreaVertexIcon(question.color, index, canClose && index === 0),
      });

      if (canClose && index === 0 && onAreaClose) {
        marker.bindTooltip('Close area', { direction: 'top', offset: L.point(0, -12) });
        marker.on('click', () => onAreaClose(question.id));
      }

      if (!question.isLocked && onQuestionDragEnd) {
        marker.on('drag', () => {
          const nextPoints = markers.map((currentMarker) => currentMarker.getLatLng());
          shape.setLatLngs(nextPoints);
        });
        marker.on('dragend', () => {
          const nextPoint = marker.getLatLng();
          onQuestionDragEnd(question.id, { lat: nextPoint.lat, lng: nextPoint.lng }, index);
        });
      }
      return marker;
    });

    layers.push(shape, ...markers);
  }

  private buildPlayableArea(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>,
    questions: GameQuestion[],
    thermometerBbox: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null,
  ): FeatureCollection<Polygon> | null {
    if (questions.length === 0) {
      return null;
    }

    let playableArea = toPolygonFeatureCollection(activeCountryGeometry);

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
        if (!thermometerBbox) {
          continue;
        }

        const thermometerArea = {
          type: 'Feature' as const,
          properties: {},
          geometry: createThermometerAreaPolygon(
            question.start,
            question.end,
            question.applied.mode,
            thermometerBbox,
          ),
        };

        playableArea = intersectGeometry(playableArea, thermometerArea);
      } else if (isAreaQuestion(question) && question.isClosed) {
        const area = {
          type: 'Feature' as const,
          properties: {},
          geometry: createAreaPolygon(question.vertices),
        };
        playableArea =
          question.applied.mode === 'inside'
            ? intersectGeometry(playableArea, area)
            : subtractGeometry(playableArea, area);
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
    thermometerBbox: { minLng: number; maxLng: number; minLat: number; maxLat: number } | null,
  ): L.LatLngBounds | null {
    const playableArea = this.buildPlayableArea(activeCountryGeometry, questions, thermometerBbox);
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
      } else if (isAreaQuestion(question)) {
        const questionBounds = getAreaQuestionBounds(question);
        if (!bounds) {
          bounds = questionBounds;
        } else {
          bounds.extend(questionBounds);
        }
      }
    }

    return bounds;
  }
}

function createUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: 'user-location-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: '<span class="user-location-marker__pulse"></span><span class="user-location-marker__dot"></span>',
  });
}
