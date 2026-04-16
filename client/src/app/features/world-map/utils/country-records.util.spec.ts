import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import {
  createCountryRecords,
  getCountryRecordByCode,
  toCountryFeatureCollection,
  toCountryOptions
} from './country-records.util';
import type { CountryMetadataRecord } from '../models/country.model';

describe('country-data', () => {
  it('creates sorted sovereign country records with matching geometry', () => {
    const geometry: FeatureCollection<Polygon | MultiPolygon, { name?: string }> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '894',
          properties: { name: 'Zeta' },
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
        },
        {
          type: 'Feature',
          id: '004',
          properties: { name: 'Alpha' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [2, 2],
                [3, 2],
                [3, 3],
                [2, 3],
                [2, 2]
              ]
            ]
          }
        }
      ]
    };
    const countries: CountryMetadataRecord[] = [
      { ccn3: '004', cca3: 'AFG', cca2: 'AF', name: 'Afghanistan' },
      { ccn3: '008', cca3: 'ALB', cca2: 'AL', name: 'Albania' },
      { ccn3: '894', cca3: 'ZMB', cca2: 'ZM', name: 'Zambia' }
    ];

    expect(createCountryRecords(geometry, countries)).toEqual([
      {
        code: 'AFG',
        code2: 'AF',
        name: 'Afghanistan',
        feature: {
          ...geometry.features[1],
          properties: { name: 'Alpha', A3: 'AFG' }
        }
      },
      {
        code: 'ZMB',
        code2: 'ZM',
        name: 'Zambia',
        feature: {
          ...geometry.features[0],
          properties: { name: 'Zeta', A3: 'ZMB' }
        }
      }
    ]);
  });

  it('creates select options and feature collections from joined records', () => {
    const records = createCountryRecords(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: '004',
            properties: { name: 'Alpha' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2]
                ]
              ]
            }
          }
        ]
      },
      [{ ccn3: '004', cca3: 'AFG', cca2: 'AF', name: 'Afghanistan' }]
    );

    expect(toCountryOptions(records)).toEqual([
      { code: 'AFG', name: 'Afghanistan' }
    ]);
    expect(toCountryFeatureCollection(records).features).toHaveLength(1);
  });

  it('returns null when the selected country code is empty or unknown', () => {
    const records = createCountryRecords(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: '004',
            properties: { name: 'Alpha' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2]
                ]
              ]
            }
          }
        ]
      },
      [{ ccn3: '004', cca3: 'AFG', cca2: 'AF', name: 'Afghanistan' }]
    );

    expect(getCountryRecordByCode(null, records)).toBeNull();
    expect(getCountryRecordByCode('UNKNOWN', records)).toBeNull();
    expect(getCountryRecordByCode('AFG', records)?.name).toBe('Afghanistan');
  });
});
