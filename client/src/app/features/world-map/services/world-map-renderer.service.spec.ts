import * as L from 'leaflet';
import { afterEach, describe, expect, it } from 'vitest';

import type { ThermometerQuestion } from '../models/thermometer-question.model';
import { getProjectedMidpoint } from '../utils/geometry.util';
import { WorldMapRendererService } from './world-map-renderer.service';

describe('WorldMapRendererService', () => {
  let renderer: WorldMapRendererService | undefined;

  afterEach(() => {
    renderer?.destroyMap();
    renderer = undefined;
    document.body.replaceChildren();
  });

  it('places and updates the thermometer center marker at the projected midpoint', () => {
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.append(container);

    renderer = new WorldMapRendererService();
    renderer.initializeMap(container);
    const question: ThermometerQuestion = {
      id: 'thermometer-1',
      type: 'thermometer',
      color: '#d1493f',
      isCollapsed: false,
      isLocked: false,
      center: { lat: 0, lng: 0 },
      start: { lat: 62.5, lng: -125 },
      end: { lat: 28.25, lng: 105 },
      applied: { mode: 'warmer' },
      draft: { mode: 'warmer' },
    };

    renderer.renderMapState(null, { type: 'FeatureCollection', features: [] }, [question], 0, false, () => undefined);

    const questionLayers: L.Layer[] = [];
    renderer.getMap()?.eachLayer((layer) => {
      if (layer instanceof L.LayerGroup) {
        layer.eachLayer((child) => questionLayers.push(child));
      }
    });
    const midpointMarker = questionLayers.find(
      (layer): layer is L.CircleMarker => layer instanceof L.CircleMarker && layer.options.radius === 4,
    );
    const startMarker = questionLayers.find(
      (layer): layer is L.Marker =>
        layer instanceof L.Marker && layer.options.icon?.options.className?.includes('thermometer-marker--start') === true,
    );

    expect(midpointMarker).toBeDefined();
    expect(startMarker).toBeDefined();
    expect(midpointMarker?.getLatLng()).toEqual(expect.objectContaining(getProjectedMidpoint(question.start, question.end)));

    const draggedStart = { lat: 47.75, lng: -80 };
    startMarker?.setLatLng(draggedStart).fire('drag');

    expect(midpointMarker?.getLatLng()).toEqual(expect.objectContaining(getProjectedMidpoint(draggedStart, question.end)));
  });
});
