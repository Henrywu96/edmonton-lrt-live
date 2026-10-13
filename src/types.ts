/** Shape of public/data/lrt.json, written by scripts/build-gtfs.mjs from the ETS GTFS feed. */
export interface LrtData {
  version: number;
  generatedAt: string;
  source: {
    url: string;
    lastModified?: string;
    feedVersion?: string;
    feedStart?: string;
    feedEnd?: string;
    publisher?: string;
  };
  /** agency time zone, e.g. America/Edmonton */
  timezone: string;
  lines: LineData[];
  stations: StationData[];
  shapes: ShapeData[];
  patterns: PatternData[];
  services: ServiceData[];
  /** per-trip timing: [arr0, dep0, arr1, dep1, …] in seconds after the trip's first departure */
  profiles: number[][];
  /** GTFS block_id values (one block = one train working several trips) */
  blocks: string[];
  /** [trip_id, pattern, service, start (seconds after service-day midnight), profile, block (-1 when none)] */
  trips: TripRow[];
}

export type TripRow = [string, number, number, number, number, number];

export interface LineData {
  id: string;
  name: string;
  short: string;
  color: string;
  textColor: string;
  routeIds: string[];
}

export interface StationData {
  id: string;
  name: string;
  lon: number;
  lat: number;
  lines: string[];
  stopIds: string[];
}

export interface ShapeData {
  id: string;
  line: string;
  /** flat [lon, lat, lon, lat, …] */
  coords: number[];
}

export interface PatternData {
  id: string;
  line: string;
  dir: number;
  headsign: string;
  /** index into shapes */
  shape: number;
  /** index into stations, in travel order */
  stations: number[];
  /** where each stop sits on the shape: vertex index + fraction of the next segment */
  at: number[];
}

export interface ServiceData {
  id: string;
  /** Monday … Sunday as "1111100" */
  days: string;
  start: string;
  end: string;
  add: string[];
  remove: string[];
}
