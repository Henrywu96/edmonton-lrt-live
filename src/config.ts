/** App-wide settings. Data-specific values (lines, stations, times) come from public/data/lrt.json. */

export type StockKey = 'u2' | 'flexity';
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

/** Rolling stock drawn for each line (anything else gets the high-floor cars) */
export const LINE_STOCK: Record<string, StockKey> = { capital: 'u2', metro: 'u2', valley: 'flexity' };

/**
 * Capital and Metro run in tunnel through downtown and under the university.
 * Links between two of these stations are underground, links from one of them to a surface
 * station are underground for the half next to it, except where `open` says otherwise.
 */
export const UNDERGROUND = {
  lines: ['capital', 'metro'],
  stations: ['churchill', 'central', 'bay', 'corona', 'government centre', 'university', 'health sciences'],
  /** [station, station, from, to]: the part of that link (as a fraction, either direction) that is above ground */
  open: [['government centre', 'university', 0.3, 0.8]] as [string, string, number, number][],
};

/** Capital and Metro share the downtown tunnel; their route lines are drawn side by side there */
export const LINE_OFFSET: Record<string, number> = { capital: -1, metro: 1 };

/** Seconds a train is shown waiting on the platform before its first departure, and after arriving */
export const PRE_SHOW = 90;
export const ARR_DWELL = 40;
