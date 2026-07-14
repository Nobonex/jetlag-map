import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTypographyModule } from 'ng-zorro-antd/typography';

import { CountryBoundaryService } from '../../services/country-boundary.service';
import { QuestionsService } from '../../services/questions.service';
import { WorldMapRendererService } from '../../services/world-map-renderer.service';
import { WorldMapStateService } from '../../services/world-map-state.service';
import { QuestionsSidebarComponent } from '../../components/questions-sidebar/questions-sidebar.component';
import { isAreaQuestion } from '../../models/radar-question.model';
import { UserLocationService } from '../../services/user-location.service';
import { RailwayStationService } from '../../services/railway-station.service';

const CONTEXT_MENU_WIDTH = 300;
const CONTEXT_MENU_HEIGHT = 250;
const CONTEXT_MENU_MARGIN = 12;
const LONG_PRESS_DURATION_MS = 550;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_CONTEXT_MENU_SUPPRESS_MS = 800;
const TOUCH_GESTURE_CONTEXT_MENU_SUPPRESS_MS = 1200;

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
    QuestionsSidebarComponent,
  ],
  templateUrl: './world-map-page.component.html',
  styleUrl: './world-map-page.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'onEscapeKey()',
  },
})
export class WorldMapPageComponent implements AfterViewInit, OnDestroy {
  private static readonly mobileSidebarMediaQuery = '(max-width: 720px)';

  private readonly countryBoundaryService = inject(CountryBoundaryService);
  private readonly questionsService = inject(QuestionsService);
  private readonly worldMapStateService = inject(WorldMapStateService);
  private readonly worldMapRendererService = inject(WorldMapRendererService);
  private readonly modalService = inject(NzModalService);
  private readonly userLocationService = inject(UserLocationService);
  private readonly ngZone = inject(NgZone);
  private readonly railwayStationService = inject(RailwayStationService);

  protected readonly $isSidebarExpanded = signal(true);
  protected readonly $isSheetDragging = signal(false);
  protected readonly $sheetDragTransform = signal<string | null>(null);
  protected readonly $shareButtonLabel = signal('Share');
  protected readonly $contextMenuPosition = signal<ContextMenuPosition | null>(null);
  protected readonly $selectedCountryCode = this.worldMapStateService.$selectedCountryCode;
  protected readonly $questions = this.questionsService.$questions;
  protected readonly $countryOptions = this.countryBoundaryService.$countryOptions;
  protected readonly $isLoadingCountries = this.countryBoundaryService.$isLoadingCountries;
  protected readonly $isTrackingLocation = this.userLocationService.$isTracking;
  protected readonly $areStationRadiiEnabled = signal(false);
  protected readonly $stationCount = signal<number | null>(null);
  protected readonly $stationRadiiNeedZoom = signal(false);
  protected readonly $isLoadingStations = this.railwayStationService.$isLoading;
  protected readonly $stationError = this.railwayStationService.$error;
  protected readonly $locationMenuLabel = computed(() => {
    if (this.$isTrackingLocation()) {
      return 'Hide my location';
    }
    return this.userLocationService.$error() ?? 'Show my location';
  });
  protected readonly isLocationSupported = this.userLocationService.isSupported;
  protected readonly $canClearSavedData = computed(
    () => this.$questions().length > 0 || this.$selectedCountryCode() !== null,
  );
  protected readonly $stationRadiusMenuLabel = computed(() => {
    if (this.$isLoadingStations()) {
      return 'Loading train stations...';
    }
    if (this.$stationError()) {
      return 'Station loading failed - retry';
    }
    return this.$areStationRadiiEnabled()
      ? 'Hide 1 km station zones'
      : 'Show 1 km around train stations';
  });
  protected readonly $stationRadiusStatus = computed(() => {
    if (this.$isLoadingStations()) {
      return 'Loading train stations';
    }
    const error = this.$stationError();
    if (error) {
      return error;
    }
    const count = this.$stationCount();
    if (!this.$areStationRadiiEnabled() || count === null) {
      return null;
    }
    return this.$stationRadiiNeedZoom()
      ? `${count} stations loaded - zoom in to see the 1 km zones`
      : `${count} train stations and halts loaded`;
  });
  protected readonly $drawingAreaQuestionId = computed(
    () =>
      this.$questions().find((question) => isAreaQuestion(question) && !question.isClosed)?.id ??
      null,
  );
  protected readonly $drawingAreaPointCount = computed(() => {
    const question = this.$questions().find(
      (candidate) => isAreaQuestion(candidate) && !candidate.isClosed,
    );
    return question && isAreaQuestion(question) ? question.vertices.length : 0;
  });

  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer?: ElementRef<HTMLDivElement>;

  @ViewChild('appHeader', { static: true })
  private readonly appHeader?: ElementRef<HTMLElement>;

  @ViewChild('questionSidebar')
  private readonly questionSidebar?: ElementRef<HTMLElement>;

  @ViewChild('contextMenu')
  private readonly contextMenu?: ElementRef<HTMLElement>;

  private mobileSidebarQuery?: MediaQueryList;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressStartPoint: ScreenPoint | null = null;
  private longPressSuppressUntil = 0;
  private touchGestureSuppressUntil = 0;
  private readonly activeMapPointerIds = new Set<number>();
  private contextMenuLatLng: L.LatLng | null = null;
  private shareLabelTimer: ReturnType<typeof setTimeout> | null = null;
  private sheetDragStartY: number | null = null;
  private sheetDragStartOffset = 0;
  private sheetDragMaxOffset = 0;
  private sheetDidDrag = false;
  private suppressNextSheetClick = false;

  private readonly onMobileSidebarQueryChange = (event: MediaQueryListEvent): void => {
    this.syncSidebarExpansion(event.matches);
  };

  private readonly onNativeMapPointerMove = (event: PointerEvent): void => {
    this.onMapPointerMove(event);
  };

  private readonly syncRenderEffect = effect(() => {
    this.$questions();
    this.$selectedCountryCode();
    this.triggerRender(false);
  });

  private readonly syncUserLocationEffect = effect(() => {
    const position = this.userLocationService.$position();
    if (position) {
      this.worldMapRendererService.showUserLocation(position);
    } else {
      this.worldMapRendererService.clearUserLocation();
    }
  });

  async ngAfterViewInit(): Promise<void> {
    this.initializeResponsiveSidebar();
    this.initializeMap();
    this.initializePointerMoveListener();
    await this.countryBoundaryService.loadCountries();
    await this.worldMapStateService.restoreSelectedCountry();
    this.triggerRender(true);
  }

  ngOnDestroy(): void {
    void this.syncRenderEffect;
    void this.syncUserLocationEffect;
    this.userLocationService.stop();
    this.railwayStationService.cancelRequest();
    this.detachResponsiveSidebarListener();
    this.detachPointerMoveListener();
    this.clearLongPressTimer();
    if (this.shareLabelTimer) {
      clearTimeout(this.shareLabelTimer);
    }
    this.worldMapRendererService.destroyMap();
  }

  protected onSelectedCountryChange(countryCode: string | null): void {
    this.closeContextMenu();
    this.railwayStationService.cancelRequest();
    this.worldMapRendererService.clearStationRadii();
    this.$stationCount.set(null);
    this.$stationRadiiNeedZoom.set(false);
    this.worldMapStateService.setSelectedCountry(countryCode);

    if (!countryCode) {
      this.$areStationRadiiEnabled.set(false);
      this.triggerRender(true);
      return;
    }

    if (this.$areStationRadiiEnabled()) {
      void this.loadStationRadii(countryCode);
    }

    void this.countryBoundaryService.loadDetailedCountryGeometry(countryCode).then(() => {
      this.triggerRender(true);
    });
  }

  protected toggleSidebar(): void {
    if (!this.mobileSidebarQuery?.matches) {
      return;
    }

    const shouldExpand = !this.$isSidebarExpanded();
    this.$isSidebarExpanded.set(shouldExpand);

    if (shouldExpand) {
      requestAnimationFrame(() => {
        this.questionSidebar?.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }

    requestAnimationFrame(() => this.worldMapRendererService.invalidateSize());
  }

  protected onSheetToggle(): void {
    if (this.suppressNextSheetClick) {
      this.suppressNextSheetClick = false;
      return;
    }
    this.toggleSidebar();
  }

  protected onSheetPointerDown(event: PointerEvent): void {
    if (!this.mobileSidebarQuery?.matches || event.button !== 0) {
      return;
    }

    const target = event.currentTarget;
    if (!(target instanceof HTMLElement) || !target.parentElement) {
      return;
    }
    const sheet = target.parentElement;

    this.sheetDragStartY = event.clientY;
    this.sheetDragMaxOffset = Math.max(0, sheet.getBoundingClientRect().height - 58);
    this.sheetDragStartOffset = this.$isSidebarExpanded() ? 0 : this.sheetDragMaxOffset;
    this.sheetDidDrag = false;
    this.$isSheetDragging.set(true);
    target.setPointerCapture(event.pointerId);
  }

  protected onSheetPointerMove(event: PointerEvent): void {
    if (this.sheetDragStartY === null) {
      return;
    }

    const distance = event.clientY - this.sheetDragStartY;
    if (Math.abs(distance) > 6) {
      this.sheetDidDrag = true;
      this.suppressNextSheetClick = true;
    }
    const offset = Math.min(
      Math.max(this.sheetDragStartOffset + distance, 0),
      this.sheetDragMaxOffset,
    );
    this.$sheetDragTransform.set(`translateY(${offset}px)`);
  }

  protected onSheetPointerUp(): void {
    if (this.sheetDragStartY === null) {
      return;
    }

    if (this.sheetDidDrag) {
      const transform = this.$sheetDragTransform();
      const offset = transform ? Number.parseFloat(transform.replace(/[^\d.]/g, '')) : 0;
      this.$isSidebarExpanded.set(offset < this.sheetDragMaxOffset / 2);
    }
    this.sheetDragStartY = null;
    this.sheetDidDrag = false;
    this.$isSheetDragging.set(false);
    this.$sheetDragTransform.set(null);
    requestAnimationFrame(() => this.worldMapRendererService.invalidateSize());
  }

  protected onMapContextMenu(event: MouseEvent): void {
    event.preventDefault();

    if (
      event.timeStamp < this.longPressSuppressUntil ||
      event.timeStamp < this.touchGestureSuppressUntil
    ) {
      return;
    }

    const latLng = this.worldMapRendererService.mouseEventToLatLng(event);
    if (!latLng) {
      return;
    }

    this.openContextMenu(event.clientX, event.clientY, latLng);
  }

  protected onMapClick(event: MouseEvent): void {
    const questionId = this.$drawingAreaQuestionId();
    const target = event.target;
    if (!questionId || (target instanceof Element && target.closest('.leaflet-marker-icon'))) {
      return;
    }

    const point = this.worldMapRendererService.mouseEventToLatLng(event);
    if (point) {
      this.questionsService.addAreaVertex(questionId, { lat: point.lat, lng: point.lng });
    }
  }

  protected onMapPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.button !== 0) {
      return;
    }

    this.activeMapPointerIds.add(event.pointerId);
    if (this.activeMapPointerIds.size > 1) {
      this.suppressTouchGestureContextMenu(event.timeStamp);
      this.clearLongPressTimer();
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.leaflet-marker-icon, .leaflet-marker-shadow')
    ) {
      return;
    }

    this.clearLongPressTimer();
    this.longPressStartPoint = { x: event.clientX, y: event.clientY };
    this.longPressTimer = setTimeout(() => {
      this.longPressSuppressUntil = event.timeStamp + LONG_PRESS_CONTEXT_MENU_SUPPRESS_MS;
      const latLng = this.worldMapRendererService.mouseEventToLatLng(event);
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

    const movedDistance = Math.hypot(
      event.clientX - this.longPressStartPoint.x,
      event.clientY - this.longPressStartPoint.y,
    );

    if (movedDistance > LONG_PRESS_MOVE_THRESHOLD_PX) {
      this.suppressTouchGestureContextMenu(event.timeStamp);
      this.clearLongPressTimer();
    }
  }

  protected onMapPointerUp(event: PointerEvent): void {
    this.activeMapPointerIds.delete(event.pointerId);
    this.clearLongPressTimer();
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.$contextMenuPosition()) {
      return;
    }

    const contextMenuElement = this.contextMenu?.nativeElement;
    if (!contextMenuElement) {
      return;
    }

    if (event.target instanceof Node && contextMenuElement.contains(event.target)) {
      return;
    }

    this.closeContextMenu();
  }

  protected onEscapeKey(): void {
    this.closeContextMenu();
  }

  protected addRadarQuestion(): void {
    const center = this.contextMenuLatLng ?? this.getQuestionsBounds()?.getCenter();
    if (!center) {
      return;
    }

    this.questionsService.addRadarQuestion({ lat: center.lat, lng: center.lng });
    this.closeContextMenu();
  }

  protected addThermometerQuestion(): void {
    const start = this.contextMenuLatLng ?? this.getQuestionsBounds()?.getCenter();
    if (!start) {
      return;
    }

    // Place end marker ~0.01 degrees north (~1.1km) so user can easily drag both
    const end = { lat: start.lat + 0.01, lng: start.lng };

    this.questionsService.addThermometerQuestion(
      { lat: start.lat, lng: start.lng },
      { lat: end.lat, lng: end.lng },
    );
    this.closeContextMenu();
  }

  protected addAreaQuestion(): void {
    if (this.$drawingAreaQuestionId()) {
      this.closeContextMenu();
      return;
    }

    const start = this.contextMenuLatLng ?? this.getQuestionsBounds()?.getCenter();
    if (!start) {
      return;
    }

    this.questionsService.addAreaQuestion({ lat: start.lat, lng: start.lng });
    this.closeContextMenu();
  }

  protected openQuestionPicker(): void {
    const map = this.worldMapRendererService.getMap();
    if (!map) {
      return;
    }

    this.contextMenuLatLng = map.getCenter();
    this.$contextMenuPosition.set({ x: 18, y: 18 });
  }

  protected finishAreaDrawing(): void {
    const questionId = this.$drawingAreaQuestionId();
    if (questionId && this.$drawingAreaPointCount() >= 3) {
      this.questionsService.closeAreaQuestion(questionId);
    }
  }

  protected cancelAreaDrawing(): void {
    const questionId = this.$drawingAreaQuestionId();
    if (questionId) {
      this.questionsService.deleteQuestion(questionId);
    }
  }

  protected confirmClearQuestions(): void {
    this.modalService.confirm({
      nzTitle: 'Clear saved data?',
      nzContent:
        'This will remove saved radar questions, the selected country, and cached country boundaries from local storage on this device.',
      nzOkText: 'Clear saved data',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.clearSavedData(),
    });
  }

  protected toggleUserLocation(): void {
    if (this.$isTrackingLocation()) {
      this.userLocationService.stop();
      return;
    }

    this.userLocationService.start();
  }

  protected toggleStationRadii(): void {
    const countryCode = this.$selectedCountryCode();
    if (!countryCode) {
      return;
    }

    if (this.$areStationRadiiEnabled() && !this.$stationError()) {
      this.disableStationRadii();
      return;
    }

    this.$areStationRadiiEnabled.set(true);
    void this.loadStationRadii(countryCode);
  }

  protected async shareState(): Promise<void> {
    const shareLink = this.worldMapStateService.createShareLink();
    const copied = await copyText(shareLink);
    this.$shareButtonLabel.set(copied ? 'Link copied' : 'Copy failed');

    if (this.shareLabelTimer) {
      clearTimeout(this.shareLabelTimer);
    }
    this.shareLabelTimer = setTimeout(() => this.$shareButtonLabel.set('Share'), 2000);
  }

  protected closeContextMenu(): void {
    this.$contextMenuPosition.set(null);
    this.contextMenuLatLng = null;
  }

  private initializeMap(): void {
    if (!this.mapContainer) {
      return;
    }

    this.worldMapRendererService.initializeMap(this.mapContainer.nativeElement);
    requestAnimationFrame(() => this.worldMapRendererService.invalidateSize());
  }

  private initializePointerMoveListener(): void {
    const mapElement = this.mapContainer?.nativeElement;
    if (!mapElement) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      mapElement.addEventListener('pointermove', this.onNativeMapPointerMove, { passive: true });
    });
  }

  private detachPointerMoveListener(): void {
    this.mapContainer?.nativeElement.removeEventListener(
      'pointermove',
      this.onNativeMapPointerMove,
    );
  }

  private triggerRender(shouldFitMap: boolean): void {
    const activeCountry = this.countryBoundaryService.getCountryByCode(this.$selectedCountryCode());
    const activeCountryGeometry = activeCountry
      ? this.countryBoundaryService.getCountryGeometry(activeCountry.code)
      : null;
    const worldFeatureCollection = this.countryBoundaryService.getCountryFeatureCollection();
    const headerHeight = this.appHeader?.nativeElement?.offsetHeight ?? 68;

    this.worldMapRendererService.renderMapState(
      activeCountryGeometry,
      worldFeatureCollection,
      this.$questions(),
      headerHeight,
      shouldFitMap,
      (questionId, point, which) => {
        if (typeof which === 'number') {
          this.questionsService.updateAreaVertex(questionId, which, point);
        } else if (which === 'center') {
          this.questionsService.updateQuestionCenter(questionId, point);
        } else if (which === 'start') {
          this.questionsService.updateThermometerStart(questionId, point);
        } else if (which === 'end') {
          this.questionsService.updateThermometerEnd(questionId, point);
        }
      },
      (questionId) => this.questionsService.closeAreaQuestion(questionId),
    );
  }

  private getQuestionsBounds(): L.LatLngBounds | null {
    const questions = this.$questions();
    if (questions.length === 0) {
      return null;
    }

    // This is still needed for the context menu center fallback
    // Could be moved to a utility, but it's simple enough here
    const bounds = L.latLngBounds(
      L.latLng(questions[0].center.lat, questions[0].center.lng),
      L.latLng(questions[0].center.lat, questions[0].center.lng),
    );

    for (let i = 1; i < questions.length; i++) {
      const q = questions[i];
      bounds.extend(L.latLng(q.center.lat, q.center.lng));
    }

    return bounds;
  }

  private clearSavedData(): void {
    this.disableStationRadii();
    this.worldMapStateService.clearSavedData();
    this.closeContextMenu();
    this.triggerRender(true);
  }

  private async loadStationRadii(countryCode: string): Promise<void> {
    const country = this.countryBoundaryService.getCountryByCode(countryCode);
    if (!country) {
      return;
    }

    this.$stationCount.set(null);
    try {
      const stations = await this.railwayStationService.loadStations(country);
      if (this.$areStationRadiiEnabled() && this.$selectedCountryCode() === countryCode) {
        this.$stationCount.set(stations.length);
        this.worldMapRendererService.showStationRadii(stations, (needsMoreZoom) => {
          this.$stationRadiiNeedZoom.set(needsMoreZoom);
        });
      }
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.worldMapRendererService.clearStationRadii();
      }
    }
  }

  private disableStationRadii(): void {
    this.railwayStationService.cancelRequest();
    this.worldMapRendererService.clearStationRadii();
    this.$areStationRadiiEnabled.set(false);
    this.$stationCount.set(null);
    this.$stationRadiiNeedZoom.set(false);
  }

  private openContextMenu(clientX: number, clientY: number, latLng: L.LatLng): void {
    if (!this.mapContainer) {
      return;
    }

    const rect = this.mapContainer.nativeElement.getBoundingClientRect();
    const x = Math.min(
      Math.max(clientX - rect.left, CONTEXT_MENU_MARGIN),
      Math.max(CONTEXT_MENU_MARGIN, rect.width - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN),
    );
    const y = Math.min(
      Math.max(clientY - rect.top, CONTEXT_MENU_MARGIN),
      Math.max(CONTEXT_MENU_MARGIN, rect.height - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN),
    );

    this.$contextMenuPosition.set({ x, y });
    this.contextMenuLatLng = latLng;
  }

  private initializeResponsiveSidebar(): void {
    if (typeof globalThis.matchMedia !== 'function') {
      return;
    }

    this.mobileSidebarQuery = globalThis.matchMedia(WorldMapPageComponent.mobileSidebarMediaQuery);
    this.syncSidebarExpansion(this.mobileSidebarQuery.matches);
    this.mobileSidebarQuery.addEventListener('change', this.onMobileSidebarQueryChange);
  }

  private detachResponsiveSidebarListener(): void {
    if (!this.mobileSidebarQuery) {
      return;
    }

    this.mobileSidebarQuery.removeEventListener('change', this.onMobileSidebarQueryChange);
  }

  private syncSidebarExpansion(isMobileViewport: boolean): void {
    this.$isSidebarExpanded.set(!isMobileViewport);
    requestAnimationFrame(() => this.worldMapRendererService.invalidateSize());
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStartPoint = null;
  }

  private suppressTouchGestureContextMenu(eventTimeStamp: number): void {
    this.touchGestureSuppressUntil = Math.max(
      this.touchGestureSuppressUntil,
      eventTimeStamp + TOUCH_GESTURE_CONTEXT_MENU_SUPPRESS_MS,
    );
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

async function copyText(value: string): Promise<boolean> {
  try {
    if (globalThis.navigator.clipboard) {
      await globalThis.navigator.clipboard.writeText(value);
      return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    textArea.remove();
    return copied;
  } catch {
    return false;
  }
}
