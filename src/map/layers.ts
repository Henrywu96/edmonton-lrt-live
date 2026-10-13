import type { ExpressionSpecification, FilterSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { GLYPHS } from '../config';
import type { Network } from '../lib/network';

/** OpenFreeMap styles without buildings: a clean street map, like the old version asked for */
export function withoutBuildings(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.filter((l) => !('source-layer' in l && l['source-layer'] === 'building')),
  };
}

/** an empty map (background only), for offline use: ?basemap=none */
export function blankStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0ec' } }],
  };
}

/** the font stack the basemap already uses for labels, in bold when it has one */
function labelFont(map: MlMap): string[] {
  for (const l of map.getStyle().layers) {
    if (l.type !== 'symbol') continue;
    const f = l.layout?.['text-font'];
    if (Array.isArray(f) && f.every((x) => typeof x === 'string')) return (f as string[]).map((x) => x.replace(/Regular|Italic/, 'Bold'));
  }
  return ['Noto Sans Bold'];
}

const zoomed = (a: number, b: number, c: number, d: number): ExpressionSpecification => ['interpolate', ['exponential', 1.5], ['zoom'], 9, a, 12, b, 15, c, 18, d];
const offset = (a: number, b: number, c: number, d: number): ExpressionSpecification => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  9,
  ['*', ['get', 'off'], a],
  12,
  ['*', ['get', 'off'], b],
  15,
  ['*', ['get', 'off'], c],
  18,
  ['*', ['get', 'off'], d],
];

export const ROUTE_LAYERS = ['lrt-casing', 'lrt-line', 'lrt-line-ug'] as const;

export function routeFilter(id: (typeof ROUTE_LAYERS)[number], hidden: string[]): FilterSpecification {
  const visible: ExpressionSpecification = ['!', ['in', ['get', 'line'], ['literal', hidden]]];
  const ug: ExpressionSpecification = id === 'lrt-line-ug' ? ['==', ['get', 'ug'], true] : ['==', ['get', 'ug'], false];
  return ['all', visible, ug];
}

/** route lines under the basemap's labels, stations on top; the train layer goes between the two */
export function addNetworkLayers(map: MlMap, net: Network, opts: { dark: boolean; hidden: string[] }) {
  // under the basemap's text labels (one-way arrows and other icon-only symbols do not count)
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol' && l.layout?.['text-field'] !== undefined)?.id;
  map.addSource('lrt-routes', { type: 'geojson', data: net.routeGeoJSON() });
  map.addSource('lrt-stations', { type: 'geojson', data: net.stationGeoJSON() });
  const off = offset(1.1, 1.9, 3.6, 6.4);
  map.addLayer(
    {
      id: 'lrt-casing',
      type: 'line',
      source: 'lrt-routes',
      filter: routeFilter('lrt-casing', opts.hidden),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': opts.dark ? '#0b1320' : '#ffffff', 'line-width': zoomed(3.4, 5.6, 10, 18), 'line-offset': off },
    },
    firstSymbol,
  );
  map.addLayer(
    {
      id: 'lrt-line',
      type: 'line',
      source: 'lrt-routes',
      filter: routeFilter('lrt-line', opts.hidden),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': zoomed(2, 3.4, 6.6, 12), 'line-offset': off },
    },
    firstSymbol,
  );
  map.addLayer(
    {
      id: 'lrt-line-ug',
      type: 'line',
      source: 'lrt-routes',
      filter: routeFilter('lrt-line-ug', opts.hidden),
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': zoomed(1.8, 3, 5.6, 10), 'line-dasharray': [1.3, 1], 'line-opacity': 0.85, 'line-offset': off },
    },
    firstSymbol,
  );
  const big = ['>', ['get', 'n'], 1] as ExpressionSpecification;
  map.addLayer({
    id: 'lrt-stations',
    type: 'circle',
    source: 'lrt-stations',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', big, 3.2, 2.4], 13, ['case', big, 6, 4.6], 17, ['case', big, 10, 8]],
      'circle-color': opts.dark ? '#0f1826' : '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 14, 2.6],
    },
  });
  map.addLayer({
    id: 'lrt-station-sel',
    type: 'circle',
    source: 'lrt-stations',
    filter: ['in', ['get', 'idx'], ['literal', []]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 11, 17, 16],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#ffb627',
      'circle-stroke-width': 3,
    },
  });
}

/** station names: added after the train layer so they sit on top of everything */
export function addStationLabels(map: MlMap, dark: boolean) {
  map.addLayer({
    id: 'lrt-station-labels',
    type: 'symbol',
    source: 'lrt-stations',
    minzoom: 11.4,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': labelFont(map),
      'text-size': ['interpolate', ['linear'], ['zoom'], 11.4, 10.5, 15, 13.5],
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': 0.9,
      'text-justify': 'auto',
      'text-padding': 4,
    },
    paint: {
      'text-color': dark ? '#e6edf5' : '#1d2633',
      'text-halo-color': dark ? '#0b1320' : '#ffffff',
      'text-halo-width': 1.6,
    },
  });
}
