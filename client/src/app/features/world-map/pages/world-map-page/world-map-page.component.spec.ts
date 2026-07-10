import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import * as L from 'leaflet';
import { en_US, provideNzI18n } from 'ng-zorro-antd/i18n';

import { CountryBoundaryService } from '../../services/country-boundary.service';
import { QuestionsService } from '../../services/questions.service';
import { WorldMapStateService } from '../../services/world-map-state.service';
import { WorldMapRendererService } from '../../services/world-map-renderer.service';
import { WorldMapPageComponent } from './world-map-page.component';

const SELECTED_COUNTRY_STORAGE_KEY = 'jetlag.selected-country.v1';

describe('WorldMapPageComponent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    globalThis.localStorage.clear();
    globalThis.history.replaceState(null, '', '/');

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(
        typeof input === 'string' || input instanceof URL ? input : input.url
      );

      if (url.includes('countries-10m.topo.json')) {
        return new Response(
          JSON.stringify({
            type: 'Topology',
            transform: { scale: [1, 1], translate: [0, 0] },
            objects: {
              countries: {
                type: 'GeometryCollection',
                geometries: [
                  {
                    type: 'Polygon',
                    id: '004',
                    properties: { name: 'Afghanistan' },
                    arcs: [[0]]
                  }
                ]
              }
            },
            arcs: [[[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]]]
          })
        );
      }

      return new Response(
        JSON.stringify([
          { ccn3: '004', cca3: 'AFG', cca2: 'AF', name: 'Afghanistan' }
        ])
      );
    }) as typeof fetch;

    await TestBed.configureTestingModule({
      imports: [WorldMapPageComponent],
      providers: [provideAnimationsAsync('noop'), provideNzI18n(en_US)]
    }).compileComponents();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage.clear();
  });

  it('should render title and country selector', async () => {
    const fixture = TestBed.createComponent(WorldMapPageComponent);
    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.app-brand')?.textContent).toContain('JetLag');
    expect(compiled.querySelector('nz-select')).not.toBeNull();
    expect(compiled.querySelector('.share-button')?.textContent).toContain('Share');
    expect(compiled.querySelector('.question-sidebar')?.getAttribute('tabindex')).toBe('0');
  });

  it('should restore a persisted selected country', async () => {
    globalThis.localStorage.setItem(SELECTED_COUNTRY_STORAGE_KEY, 'AFG');

    const fixture = TestBed.createComponent(WorldMapPageComponent);
    const countryBoundaryService = TestBed.inject(CountryBoundaryService);

    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    vi.spyOn(countryBoundaryService, 'loadDetailedCountryGeometry').mockResolvedValue();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['$selectedCountryCode']()).toBe('AFG');
  });

  it('should remove an invalid persisted selected country', async () => {
    globalThis.localStorage.setItem(SELECTED_COUNTRY_STORAGE_KEY, 'ZZZ');

    const fixture = TestBed.createComponent(WorldMapPageComponent);
    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    fixture.detectChanges();
    await fixture.whenStable();

    expect(globalThis.localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY)).toBeNull();
  });

  it('should persist country selection changes', async () => {
    const fixture = TestBed.createComponent(WorldMapPageComponent);
    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['onSelectedCountryChange']('AFG');

    expect(globalThis.localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY)).toBe('AFG');

    fixture.componentInstance['onSelectedCountryChange'](null);

    expect(globalThis.localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY)).toBeNull();
  });

  it('should restore the state embedded in a share link instead of local state', async () => {
    const questionsService = TestBed.inject(QuestionsService);
    const worldMapStateService = TestBed.inject(WorldMapStateService);
    worldMapStateService.setSelectedCountry('AFG');
    questionsService.addAreaQuestion({ lat: 38.72, lng: -9.14 });
    questionsService.addAreaVertex('area-1', { lat: 38.75, lng: -9.1 });
    questionsService.addAreaVertex('area-1', { lat: 38.68, lng: -9.08 });
    questionsService.closeAreaQuestion('area-1');
    questionsService.updateQuestionTitle('area-1', 'Lisbon café');
    const shareLink = worldMapStateService.createShareLink();

    worldMapStateService.clearSavedData();
    questionsService.addThermometerQuestion({ lat: 1, lng: 2 }, { lat: 3, lng: 4 });
    globalThis.location.hash = new URL(shareLink).hash;

    const fixture = TestBed.createComponent(WorldMapPageComponent);
    const countryBoundaryService = TestBed.inject(CountryBoundaryService);
    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    vi.spyOn(countryBoundaryService, 'loadDetailedCountryGeometry').mockResolvedValue();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['$selectedCountryCode']()).toBe('AFG');
    expect(questionsService.$questions()).toHaveLength(1);
    expect(questionsService.$questions()[0].title).toBe('Lisbon café');
    expect(questionsService.$questions()[0].type).toBe('area');
    expect(globalThis.location.hash).toBe('');
  });

  it('should build, close, and render a drawn area question', async () => {
    const fixture = TestBed.createComponent(WorldMapPageComponent);
    vi.spyOn(fixture.componentInstance as any, 'initializeMap').mockImplementation(() => {});
    fixture.detectChanges();
    await fixture.whenStable();

    const questionsService = TestBed.inject(QuestionsService);
    const renderer = TestBed.inject(WorldMapRendererService);
    questionsService.addAreaQuestion({ lat: 10, lng: 20 });
    vi.spyOn(renderer, 'mouseEventToLatLng')
      .mockReturnValueOnce(L.latLng(15, 25))
      .mockReturnValueOnce(L.latLng(5, 30));
    fixture.componentInstance['onMapClick'](new MouseEvent('click'));
    fixture.componentInstance['onMapClick'](new MouseEvent('click'));

    expect(fixture.componentInstance['$drawingAreaQuestionId']()).toBe('area-1');
    questionsService.closeAreaQuestion('area-1');
    questionsService.updateAreaMode('area-1', 'outside');
    fixture.detectChanges();

    const areaQuestion = questionsService.$questions()[0];
    expect(areaQuestion.type).toBe('area');
    if (areaQuestion.type !== 'area') {
      throw new Error('Expected an area question');
    }
    expect(areaQuestion.vertices).toHaveLength(3);
    expect(areaQuestion.isClosed).toBe(true);
    expect(areaQuestion.applied.mode).toBe('outside');
    expect(fixture.componentInstance['$drawingAreaQuestionId']()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-area-question-card')).not.toBeNull();
  });
});
