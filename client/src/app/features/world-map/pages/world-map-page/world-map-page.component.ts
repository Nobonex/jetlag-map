import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
import { RadarQuestionsService } from '../../services/radar-questions.service';
import { WorldMapRendererService } from '../../services/world-map-renderer.service';
import { WorldMapStateService } from '../../services/world-map-state.service';
import { QuestionsSidebarComponent } from '../../components/questions-sidebar/questions-sidebar.component';

const CONTEXT_MENU_WIDTH = 220;
const CONTEXT_MENU_HEIGHT = 52;
const CONTEXT_MENU_MARGIN = 12;
const LONG_PRESS_DURATION_MS = 550;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const LONG_PRESS_CONTEXT_MENU_SUPPRESS_MS = 800;

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
  private readonly radarQuestionsService = inject(RadarQuestionsService);
  private readonly worldMapStateService = inject(WorldMapStateService);
  private readonly worldMapRendererService = inject(WorldMapRendererService);
  private readonly modalService = inject(NzModalService);

  protected readonly $isSidebarExpanded = signal(true);
  protected readonly $contextMenuPosition = signal<ContextMenuPosition | null>(null);
  protected readonly $selectedCountryCode = this.worldMapStateService.$selectedCountryCode;
  protected readonly $radarQuestions = this.radarQuestionsService.$questions;
  protected readonly $countryOptions = this.countryBoundaryService.$countryOptions;
  protected readonly $isLoadingCountries = this.countryBoundaryService.$isLoadingCountries;
  protected readonly $canClearSavedData = computed(
    () => this.$radarQuestions().length > 0 || this.$selectedCountryCode() !== null,
  );

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
  private contextMenuLatLng: L.LatLng | null = null;

  private readonly onMobileSidebarQueryChange = (event: MediaQueryListEvent): void => {
    this.syncSidebarExpansion(event.matches);
  };

  private readonly syncRadarQuestionsEffect = effect(() => {
    this.$radarQuestions();
    this.triggerRender();
  });

  private readonly syncSelectedCountryEffect = effect(() => {
    this.$selectedCountryCode();
    this.triggerRender();
  });

  async ngAfterViewInit(): Promise<void> {
    this.initializeResponsiveSidebar();
    this.initializeMap();
    await this.countryBoundaryService.loadCountries();
    await this.worldMapStateService.restoreSelectedCountry();
    this.triggerRender();
  }

  ngOnDestroy(): void {
    void this.syncRadarQuestionsEffect;
    void this.syncSelectedCountryEffect;
    this.detachResponsiveSidebarListener();
    this.clearLongPressTimer();
    this.worldMapRendererService.destroyMap();
  }

  protected onSelectedCountryChange(countryCode: string | null): void {
    this.closeContextMenu();
    this.worldMapStateService.setSelectedCountry(countryCode);

    if (!countryCode) {
      return;
    }

    void this.countryBoundaryService.loadDetailedCountryGeometry(countryCode).then(() => {
      this.triggerRender();
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

  protected onMapContextMenu(event: MouseEvent): void {
    event.preventDefault();

    if (event.timeStamp < this.longPressSuppressUntil) {
      return;
    }

    const latLng = this.worldMapRendererService.mouseEventToLatLng(event);
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
    if (target instanceof Element && target.closest('.leaflet-marker-icon, .leaflet-marker-shadow')) {
      return;
    }

    this.longPressStartPoint = { x: event.clientX, y: event.clientY };
    this.clearLongPressTimer();
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
      this.clearLongPressTimer();
    }
  }

  protected onMapPointerUp(): void {
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
    const center = this.contextMenuLatLng ?? this.getRadarQuestionsBounds()?.getCenter();
    if (!center) {
      return;
    }

    this.radarQuestionsService.addRadarQuestion({ lat: center.lat, lng: center.lng });
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
      nzOnOk: () => this.clearSavedData(),
    });
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

  private triggerRender(): void {
    const activeCountry = this.countryBoundaryService.getCountryByCode(this.$selectedCountryCode());
    const activeCountryGeometry = activeCountry
      ? this.countryBoundaryService.getCountryGeometry(activeCountry.code)
      : null;
    const worldFeatureCollection = this.countryBoundaryService.getCountryFeatureCollection();
    const headerHeight = this.appHeader?.nativeElement?.offsetHeight ?? 68;

    this.worldMapRendererService.renderMapState(
      activeCountryGeometry,
      worldFeatureCollection,
      this.$radarQuestions(),
      headerHeight,
      (questionId, center) => {
        this.worldMapRendererService.suppressNextFit();
        this.radarQuestionsService.updateQuestionCenter(questionId, center);
      },
    );
  }

  private getRadarQuestionsBounds(): L.LatLngBounds | null {
    const questions = this.$radarQuestions();
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
    this.worldMapStateService.clearSavedData();
    this.closeContextMenu();
    this.triggerRender();
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
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStartPoint = null;
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
