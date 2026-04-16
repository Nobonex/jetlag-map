import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { en_US, provideNzI18n } from 'ng-zorro-antd/i18n';

import { WorldMapPageComponent } from './world-map-page.component';

describe('WorldMapPageComponent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
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
  });

  it('should render title and country selector', async () => {
    const fixture = TestBed.createComponent(WorldMapPageComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.app-brand')?.textContent).toContain('JetLag');
    expect(compiled.querySelector('nz-select')).not.toBeNull();
    expect(compiled.querySelector('.question-sidebar')).not.toBeNull();
  });
});
