import { TestBed } from '@angular/core/testing';
import type { FeatureCollection, Polygon } from 'geojson';

import { CountryBoundaryService } from './country-boundary.service';

describe('CountryBoundaryService', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();

    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it('should clear cached country boundary entries from local storage', () => {
    const service = TestBed.inject(CountryBoundaryService);

    globalThis.localStorage.setItem(
      'jetlag-country-boundary-v4:AFG',
      JSON.stringify(createFeatureCollection())
    );
    globalThis.localStorage.setItem('jetlag.selected-country.v1', 'AFG');

    service.clearDetailedCountryGeometryCache();

    expect(globalThis.localStorage.getItem('jetlag-country-boundary-v4:AFG')).toBeNull();
    expect(globalThis.localStorage.getItem('jetlag.selected-country.v1')).toBe('AFG');
  });
});

function createFeatureCollection(): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      }
    ]
  };
}
