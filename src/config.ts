/** App-wide settings. Data-specific values (lines, stations, times) come from public/data/lrt.json. */

/** high-floor cars (Siemens U2 / SD160) or low-floor trams (Flexity Freedom) */
export type StockFamily = 'highfloor' | 'lowfloor';
export type BasemapKey = 'light' | 'gray' | 'dark' | 'none';
export type StyleMode = 'auto' | 'light' | 'gray' | 'dark';

/** OpenFreeMap vector styles: free, no API key, OpenStreetMap data. */
export const BASEMAPS: Record<Exclude<BasemapKey, 'none'>, { url: string; label: string; dark: boolean }> = {
  light: { url: 'https://tiles.openfreemap.org/styles/liberty', label: 'Map', dark: false },
  gray: { url: 'https://tiles.openfreemap.org/styles/positron', label: 'Light', dark: false },
  dark: { url: 'https://tiles.openfreemap.org/styles/dark', label: 'Dark', dark: true },
};
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Edmonton city centre, used for the day/night switch and as a fallback map centre */
export const CITY = { lon: -113.4938, lat: 53.5461 };

/** Rolling stock family for each line (anything else gets the high-floor cars) */
export const LINE_STOCK: Record<string, StockFamily> = { capital: 'highfloor', metro: 'highfloor', valley: 'lowfloor' };

/**
 * Tunnel spans on a link between two successive stops.
 * `underground` holds fractions of the distance along the GTFS track shape, FROM `from` TO `to`.
 * Reversed trips are handled automatically in Network.markUnderground().
 *
 * Portal fractions are approximate: ETS GTFS provides track geometry but no tunnel/portal
 * locations. These values are based on the known entrance/exit corridors and can be
 * refined after inspecting the map against survey/GIS portal coordinates.
 *
 * In particular, Health Sciences/Jubilee, MacEwan and Quarters are SURFACE stations.
 * The river bridges (Government Centre–University and Quarters–Muttart) stay above ground.
 */
export interface TunnelSection {
  lines: string[];
  from: string;
  to: string;
  underground: [number, number][];
}

export const TUNNEL_SECTIONS: TunnelSection[] = [
  // Capital: short 66 Street/CN railway underpass between Coliseum and Belvedere.
  { lines: ['capital'], from: 'coliseum', to: 'belvedere', underground: [[0.65, 0.70]] },
  // Capital: south of Stadium near 95 St / 106 Ave into downtown Churchill.
  { lines: ['capital'], from: 'stadium', to: 'churchill', underground: [[0.60, 1]] },
  // Metro: tunnel portal at 105 Ave / 103 St, southeast of MacEwan station.
  { lines: ['metro'], from: 'macewan', to: 'churchill', underground: [[0.15, 1]] },
  // Shared underground downtown stations.
  { lines: ['capital', 'metro'], from: 'churchill', to: 'central', underground: [[0, 1]] },
  { lines: ['capital', 'metro'], from: 'central', to: 'bay', underground: [[0, 1]] },
  { lines: ['capital', 'metro'], from: 'bay', to: 'corona', underground: [[0, 1]] },
  { lines: ['capital', 'metro'], from: 'corona', to: 'government', underground: [[0, 1]] },
  // The Dudley B. Menzies Bridge is open air between the two tunnel portals.
  { lines: ['capital', 'metro'], from: 'government', to: 'university', underground: [[0, 0.30], [0.80, 1]] },
  // Tracks emerge to the surface south of 87 Avenue, before Health Sciences/Jubilee.
  { lines: ['capital', 'metro'], from: 'university', to: 'health sciences', underground: [[0, 0.60]] },
  // Valley: Quarters Tunnel between 102 Ave east of 96 St and the north river-valley slope.
  // Its Tawatinâ Bridge approach and river crossing are above ground.
  { lines: ['valley'], from: 'quarters', to: 'muttart', underground: [[0.12, 0.47]] },
];

/** Capital and Metro share the downtown tunnel; their route lines are drawn side by side there */
export const LINE_OFFSET: Record<string, number> = { capital: -1, metro: 1 };

/** Seconds a train is shown waiting on the platform before its first departure, and after arriving */
export const PRE_SHOW = 90;
export const ARR_DWELL = 40;
