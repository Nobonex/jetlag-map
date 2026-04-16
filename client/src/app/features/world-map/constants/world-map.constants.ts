import * as L from 'leaflet';

export const WORLD_MAP_HEADER_HEIGHT = 68;
export const WORLD_MAP_DEFAULT_BOUNDS = L.latLngBounds(
  L.latLng(-58, -170),
  L.latLng(84, 190)
);
export const WORLD_MAP_MAX_BOUNDS = L.latLngBounds(
  L.latLng(-90, -180),
  L.latLng(90, 180)
);
export const WORLD_MAP_FIT_PADDING_BOTTOM_RIGHT = L.point(24, 24);
export const WORLD_MAP_MAX_SELECTION_ZOOM = 6;
