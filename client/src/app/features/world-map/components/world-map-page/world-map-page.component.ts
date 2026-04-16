import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  effect,
  inject,
  OnDestroy,
  ViewChild,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position
} from 'geojson';
import * as L from 'leaflet';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

import {
  WORLD_MAP_DEFAULT_BOUNDS,
  WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT,
  WORLD_MAP_HEADER_HEIGHT,
  WORLD_MAP_MAX_BOUNDS,
  WORLD_MAP_MAX_SELECTION_ZOOM
} from '../../constants/world-map.constants';
import type { QuestionCenter, RadarQuestion } from '../../models/radar-question.model';
import { CountryBoundaryService } from '../../services/country-boundary.service';
import { RadarQuestionsService } from '../../services/radar-questions.service';
import {
  buildOutsideMask,
  intersectGeometry,
  subtractGeometry
} from '../../utils/map-mask.util';
import { QuestionsSidebarComponent } from '../questions-sidebar/questions-sidebar.component';

const CONTEXT_MENU_WIDTH = 220;
const CONTEXT_MENU_HEIGHT = 52;
const CONTEXT_MENU_MARGIN = 12;
const LONG_PRESS_DURATION_MS = 550;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_CONTEXT_MENU_SUPPRESS_MS = 800;
const RADAR_CIRCLE_POINT_COUNT = 96;
const MAX_RADAR_PLAYABLE_AREA_ZOOM = 9;
const SELECTED_COUNTRY_STORAGE_KEY = 'jetlag.selected-country.v1';
const MAP_PATH_SMOOTH_FACTOR = 0.2;

@Component({
  selector: 'app-world-map-page',
  imports: [
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzDropDownModule,
    NzLayoutModule,
    NzModalModule,
    NzSelectModule,
    NzTypographyModule,
    QuestionsSidebarComponent
  ],
  templateUrl: './world-map-page.component.html',
  styleUrl: './world-map-page.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorldMapPageComponent implements AfterViewInit, OnDestroy {
  private static readonly mobileSidebarMediaQuery = '(max-width: 720px)';

  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer?: ElementRef<HTMLDivElement>;

  @ViewChild('appHeader', { static: true })
  private readonly appHeader?: ElementRef<HTMLElement>;

  @ViewChild('questionSidebar')
  private readonly questionSidebar?: ElementRef<HTMLElement>;

  @ViewChild('contextMenu')
  private readonly contextMenu?: ElementRef<HTMLElement>;

  private readonly countryBoundaryService = inject(CountryBoundaryService);
  private readonly radarQuestionsService = inject(RadarQuestionsService);
  private readonly modalService = inject(NzModalService);

  protected readonly selectedCountryCode = signal<string | null>(null);
  protected readonly isSidebarExpanded = signal(true);
  protected readonly contextMenuPosition = signal<ContextMenuPosition | null>(null);
  protected readonly radarQuestions = this.radarQuestionsService.questions;
  protected readonly countryOptions = this.countryBoundaryService.countryOptions;
  protected readonly isLoadingCountries = this.countryBoundaryService.isLoadingCountries;

  private map?: L.Map;
  private allCountriesLayer?: L.GeoJSON;
  private activeCountryLayer?: L.LayerGroup;
  private radarLayer?: L.LayerGroup;
  private mobileSidebarQuery?: MediaQueryList;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStartPoint: ScreenPoint | null = null;
  private longPressSuppressUntil = 0;
  private contextMenuLatLng: L.LatLng | null = null;
  private suppressNextMapFit = false;
  private readonly onMobileSidebarQueryChange = (event: MediaQueryListEvent): void => {
    this.syncSidebarExpansion(event.matches);
  };
  private readonly syncRadarQuestionsEffect = effect(() => {
    this.radarQuestions();

    if (!this.map) {
      return;
    }

    requestAnimationFrame(() => this.renderMapState());
  });

  async ngAfterViewInit(): Promise<void> {
    this.initializeResponsiveSidebar();
    this.initializeMap();
    await this.countryBoundaryService.loadCountries();
    await this.restoreSelectedCountry();
    this.renderMapState();
  }

  ngOnDestroy(): void {
    void this.syncRadarQuestionsEffect;
    this.detachResponsiveSidebarListener();
    this.clearLongPressTimer();
    this.map?.remove();
  }

  protected onSelectedCountryChange(countryCode: string | null): void {
    this.closeContextMenu();
    this.selectedCountryCode.set(countryCode);
    this.persistSelectedCountry(countryCode);
    this.renderMapState();

    if (!countryCode) {
      return;
    }

    void this.countryBoundaryService.loadDetailedCountryGeometry(countryCode).then(() => {
      if (this.selectedCountryCode() === countryCode) {
        this.renderMapState();
      }
    });
  }

  protected toggleSidebar(): void {
    if (!this.mobileSidebarQuery?.matches) {
      return;
    }

    const shouldExpand = !this.isSidebarExpanded();
    this.isSidebarExpanded.set(shouldExpand);

    if (shouldExpand) {
      requestAnimationFrame(() => {
        this.questionSidebar?.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      });
    }

    requestAnimationFrame(() => this.map?.invalidateSize());
  }

  protected onMapContextMenu(event: MouseEvent): void {
    event.preventDefault();

    if (event.timeStamp < this.longPressSuppressUntil) {
      return;
    }

    const latLng = this.map?.mouseEventToLatLng(event);
    if (!latLng) {
      return;
    }

    this.openContextMenu(event.clientX, event.clientY, latLng);
  }

  protected onMapPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.leaflet-marker-icon, .leaflet-marker-shadow')
    ) {
      return;
    }

    this.longPressStartPoint = { x: event.clientX, y: event.clientY };
    this.clearLongPressTimer();
    this.longPressTimer = setTimeout(() => {
      this.longPressSuppressUntil = event.timeStamp + LONG_PRESS_CONTEXT_MENU_SUPPRESS_MS;
      const latLng = this.map?.mouseEventToLatLng(event);
      if (latLng) {
        this.openContextMenu(event.clientX, event.clientY, latLng);
      }
      this.clearLongPressTimer();
    }, LONG_PRESS_DURATION_MS);
  }

  protected onMapPointerMove(event: PointerEvent): void {
    if (!this.longPressStartPoint) {
      return;
    }

    const movedX = event.clientX - this.longPressStartPoint.x;
    const movedY = event.clientY - this.longPressStartPoint.y;
    const movedDistance = Math.hypot(movedX, movedY);

    if (movedDistance > LONG_PRESS_MOVE_THRESHOLD_PX) {
      this.clearLongPressTimer();
    }
  }

  protected onMapPointerUp(): void {
    this.clearLongPressTimer();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.contextMenuPosition()) {
      return;
    }

    const target = event.target;
    const contextMenuElement = this.contextMenu?.nativeElement;

    // The menu is rendered conditionally, so a document pointerdown can arrive
    // before the ViewChild is attached. In that short window, avoid clearing
    // the stored map position; the backdrop will handle outside-close once the
    // menu is in the DOM.
    if (!contextMenuElement) {
      return;
    }

    if (target instanceof Node && contextMenuElement.contains(target)) {
      return;
    }

    this.closeContextMenu();
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    this.closeContextMenu();
  }

  protected addRadarQuestion(): void {
    const center = this.contextMenuLatLng ?? this.getRadarQuestionsBounds()?.getCenter();
    if (!center) {
      return;
    }

    this.radarQuestionsService.addRadarQuestion({
      lat: center.lat,
      lng: center.lng
    });
    this.closeContextMenu();
  }

  protected confirmClearQuestions(): void {
    this.modalService.confirm({
      nzTitle: 'Clear saved data?',
      nzContent:
        'This will remove saved radar questions, the selected country, and cached country boundaries from local storage on this device.',
      nzOkText: 'Clear saved data',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.clearSavedData()
    });
  }

  protected canClearSavedData(): boolean {
    return this.radarQuestions().length > 0 || this.selectedCountryCode() !== null;
  }

  private async restoreSelectedCountry(): Promise<void> {
    const storedCountryCode = this.getPersistedSelectedCountry();
    if (!storedCountryCode) {
      return;
    }

    if (!this.countryBoundaryService.getCountryByCode(storedCountryCode)) {
      this.persistSelectedCountry(null);
      return;
    }

    this.selectedCountryCode.set(storedCountryCode);
    await this.countryBoundaryService.loadDetailedCountryGeometry(storedCountryCode);
  }

  private clearSavedData(): void {
    this.radarQuestionsService.clearQuestions();
    this.countryBoundaryService.clearDetailedCountryGeometryCache();
    this.selectedCountryCode.set(null);
    this.persistSelectedCountry(null);
    this.closeContextMenu();
    this.renderMapState();
  }

  private initializeMap(): void {
    if (this.map || !this.mapContainer) {
      return;
    }

    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false,
      minZoom: 2,
      preferCanvas: true,
      maxBounds: WORLD_MAP_MAX_BOUNDS,
      maxBoundsViscosity: 1
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      noWrap: true
    }).addTo(this.map);

    this.renderMapState();
    requestAnimationFrame(() => this.map?.invalidateSize());
  }

  private renderMapState(): void {
    if (!this.map) {
      return;
    }

    const shouldFitMap = !this.suppressNextMapFit;
    this.suppressNextMapFit = false;

    this.allCountriesLayer?.removeFrom(this.map);
    this.activeCountryLayer?.removeFrom(this.map);
    this.radarLayer?.removeFrom(this.map);

    const activeCountry = this.countryBoundaryService.getCountryByCode(
      this.selectedCountryCode()
    );

    if (!activeCountry) {
      const worldFeatureCollection =
        this.countryBoundaryService.getCountryFeatureCollection();

      if (worldFeatureCollection.features.length > 0) {
        this.allCountriesLayer = L.geoJSON(worldFeatureCollection, {
          style: () => ({
            color: '#4f6578',
            weight: 0.7,
            opacity: 0.28,
            fill: false
          }),
          interactive: false
        }).addTo(this.map);
      }

      this.renderRadarLayer(null);
      if (shouldFitMap) {
        this.fitBounds(this.getRadarQuestionsBounds() ?? WORLD_MAP_DEFAULT_BOUNDS);
      }
      return;
    }

    const activeCountryGeometry =
      this.countryBoundaryService.getCountryGeometry(activeCountry.code);
    if (!activeCountryGeometry) {
      this.fitBounds(WORLD_MAP_DEFAULT_BOUNDS);
      return;
    }

     this.allCountriesLayer = L.geoJSON(buildOutsideMask(activeCountryGeometry), {
       style: () => ({
         stroke: false,
         fillColor: '#d2dae1',
         fillOpacity: 0.68,
         fillRule: 'evenodd'
       }),
       interactive: false,
       smoothFactor: MAP_PATH_SMOOTH_FACTOR
     } as L.GeoJSONOptions & L.PolylineOptions).addTo(this.map);

     const activeOutlineLayer = L.geoJSON(activeCountryGeometry, {
       style: () => ({
         color: '#19364d',
         weight: 2.2,
         opacity: 0.96,
         fill: false
       }),
       interactive: false,
       smoothFactor: MAP_PATH_SMOOTH_FACTOR
     } as L.GeoJSONOptions & L.PolylineOptions);

    this.activeCountryLayer = L.layerGroup([activeOutlineLayer]).addTo(this.map);
    this.renderRadarLayer(activeCountryGeometry);

    const playableAreaBounds = this.getPlayableAreaBounds(activeCountryGeometry);
    if (shouldFitMap) {
      this.fitBounds(
        playableAreaBounds ?? activeOutlineLayer.getBounds(),
        playableAreaBounds ? MAX_RADAR_PLAYABLE_AREA_ZOOM : WORLD_MAP_MAX_SELECTION_ZOOM
      );
    }
  }

  private fitBounds(bounds: L.LatLngBounds, maxZoom?: number): void {
    this.map?.fitBounds(bounds, {
      paddingTopLeft: L.point(24, this.getHeaderHeight() + 24),
      paddingBottomRight: WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT,
      maxZoom
    });
  }

  private getHeaderHeight(): number {
    return this.appHeader?.nativeElement?.offsetHeight ?? WORLD_MAP_HEADER_HEIGHT;
  }

  private initializeResponsiveSidebar(): void {
    if (typeof globalThis.matchMedia !== 'function') {
      return;
    }

    this.mobileSidebarQuery = globalThis.matchMedia(
      WorldMapPageComponent.mobileSidebarMediaQuery
    );
    this.syncSidebarExpansion(this.mobileSidebarQuery.matches);
    this.mobileSidebarQuery.addEventListener(
      'change',
      this.onMobileSidebarQueryChange
    );
  }

  private detachResponsiveSidebarListener(): void {
    if (!this.mobileSidebarQuery) {
      return;
    }

    this.mobileSidebarQuery.removeEventListener(
      'change',
      this.onMobileSidebarQueryChange
    );
  }

  private syncSidebarExpansion(isMobileViewport: boolean): void {
    this.isSidebarExpanded.set(!isMobileViewport);
    requestAnimationFrame(() => this.map?.invalidateSize());
  }

  private openContextMenu(clientX: number, clientY: number, latLng: L.LatLng): void {
    if (!this.mapContainer) {
      return;
    }

    const rect = this.mapContainer.nativeElement.getBoundingClientRect();
    const x = clamp(
      clientX - rect.left,
      CONTEXT_MENU_MARGIN,
      Math.max(CONTEXT_MENU_MARGIN, rect.width - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)
    );
    const y = clamp(
      clientY - rect.top,
      CONTEXT_MENU_MARGIN,
      Math.max(
        CONTEXT_MENU_MARGIN,
        rect.height - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN
      )
    );

    this.contextMenuPosition.set({ x, y });
    this.contextMenuLatLng = latLng;
  }

  protected closeContextMenu(): void {
    this.contextMenuPosition.set(null);
    this.contextMenuLatLng = null;
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    this.longPressStartPoint = null;
  }

  private getPersistedSelectedCountry(): string | null {
    try {
      return globalThis.localStorage?.getItem(SELECTED_COUNTRY_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private persistSelectedCountry(countryCode: string | null): void {
    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        return;
      }

      if (countryCode) {
        storage.setItem(SELECTED_COUNTRY_STORAGE_KEY, countryCode);
        return;
      }

      storage.removeItem(SELECTED_COUNTRY_STORAGE_KEY);
    } catch {
      // Ignore storage-access failures.
    }
  }

  private renderRadarLayer(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon> | null
  ): void {
    const questions = this.radarQuestions();
    if (!this.map || questions.length === 0) {
      return;
    }

    const radarLayers: L.Layer[] = [];

    if (activeCountryGeometry) {
      const playableArea = this.buildPlayableArea(activeCountryGeometry);
      if (playableArea && playableArea.features.length > 0) {
        const radarMask = subtractGeometry(activeCountryGeometry, playableArea);
        if (radarMask.features.length > 0) {
          radarLayers.push(
            L.geoJSON(radarMask, {
              style: () => ({
                stroke: false,
                fillColor: '#d2dae1',
                fillOpacity: 0.68
              }),
              interactive: false,
              smoothFactor: MAP_PATH_SMOOTH_FACTOR
            } as L.GeoJSONOptions & L.PolylineOptions)
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
        fillOpacity: 0.08,
        interactive: false
      });

      const radarMarker = L.marker(center, {
        draggable: !question.isLocked,
        icon: createRadarMarkerIcon(question.color)
      });

      if (!question.isLocked) {
        radarMarker.on('drag', () => {
          radarCircle.setLatLng(radarMarker.getLatLng());
        });

        radarMarker.on('dragend', () => {
          const nextCenter = radarMarker.getLatLng();
          this.suppressNextMapFit = true;
          this.radarQuestionsService.updateQuestionCenter(question.id, {
            lat: nextCenter.lat,
            lng: nextCenter.lng
          });
        });
      }

      radarLayers.push(radarCircle, radarMarker);
    }

    this.radarLayer = L.layerGroup(radarLayers).addTo(this.map);
  }

  private getRadarQuestionsBounds(): L.LatLngBounds | null {
    const questions = this.radarQuestions();
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

  private getPlayableAreaBounds(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>
  ): L.LatLngBounds | null {
    const playableArea = this.buildPlayableArea(activeCountryGeometry);
    if (!playableArea || playableArea.features.length === 0) {
      return null;
    }

    const bounds = L.geoJSON(playableArea).getBounds();
    return bounds.isValid() ? bounds : null;
  }

  private buildPlayableArea(
    activeCountryGeometry: FeatureCollection<Polygon | MultiPolygon>
  ): FeatureCollection<Polygon> | null {
    const questions = this.radarQuestions();
    if (questions.length === 0) {
      return null;
    }

    let playableArea = toPolygonFeatureCollection(activeCountryGeometry);

    for (const question of questions) {
      const radarArea = {
        type: 'Feature' as const,
        properties: {},
        geometry: createCirclePolygon(
          L.latLng(question.center.lat, question.center.lng),
          question.applied.radiusKm * 1000
        )
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
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createCirclePolygon(center: L.LatLng, radiusMeters: number): Polygon {
  const angularDistance = radiusMeters / 6371008.8;
  const latitudeRadians = degreesToRadians(center.lat);
  const longitudeRadians = degreesToRadians(center.lng);
  const coordinates: Position[] = [];

  for (let index = 0; index <= RADAR_CIRCLE_POINT_COUNT; index += 1) {
    const bearing = (2 * Math.PI * index) / RADAR_CIRCLE_POINT_COUNT;
    const nextLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance) +
        Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const nextLongitude =
      longitudeRadians +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) -
          Math.sin(latitudeRadians) * Math.sin(nextLatitude)
      );

    coordinates.push([
      normalizeLongitude(radiansToDegrees(nextLongitude)),
      radiansToDegrees(nextLatitude)
    ]);
  }

  return {
    type: 'Polygon',
    coordinates: [coordinates]
  };
}

function createRadarMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'radar-center-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span class="radar-center-marker__dot" style="--radar-color: ${color}"></span>`
  });
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function toPolygonFeatureCollection(
  geometry: FeatureCollection<Polygon | MultiPolygon>
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: geometry.features.flatMap((feature) => {
      if (feature.geometry.type === 'Polygon') {
        return [
          {
            type: 'Feature' as const,
            properties: feature.properties ?? {},
            geometry: feature.geometry
          }
        ];
      }

      return feature.geometry.coordinates.map((coordinates) => ({
        type: 'Feature' as const,
        properties: feature.properties ?? {},
        geometry: {
          type: 'Polygon' as const,
          coordinates
        }
      }));
    })
  };
}

function getRadarQuestionBounds(question: RadarQuestion): L.LatLngBounds {
  const radarFeature: Feature<Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: createCirclePolygon(
      L.latLng(question.center.lat, question.center.lng),
      question.applied.radiusKm * 1000
    )
  };

  return L.geoJSON(radarFeature).getBounds();
}
