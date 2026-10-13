#!/usr/bin/env node
/**
 * Builds public/data/lrt.json from the Edmonton Transit Service (ETS) GTFS static feed.
 *
 * Only the light rail is kept: the lines, their stations, track geometry (GTFS shapes),
 * every LRT trip with its stop times, and the service calendar. The result is a compact
 * JSON file (~100–300 KB) that the web app loads once and runs its own clock against.
 *
 *   node scripts/build-gtfs.mjs                     download the feed and build
 *   node scripts/build-gtfs.mjs --file GTFS.zip     build from a local copy of the feed
 *   node scripts/build-gtfs.mjs --if-missing        skip when the output already exists
 *   node scripts/build-gtfs.mjs --out path.json     write somewhere else
 *
 * GTFS_URL=<url> overrides the download address.
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import JSZip from 'jszip';

const FEED_URLS = [
  'https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/GTFS/GTFS.zip',
  'http://gtfs.edmonton.ca/TMGTFSRealTimeWebService/GTFS/GTFS.zip',
];

/** The three ETS lines. Known lines always use these colours so the map matches the system map. */
const KNOWN_LINES = {
  capital: { name: 'Capital Line', short: 'C', color: '#2f6fdd', textColor: '#ffffff', match: /\bcapital\b/i, stations: /clareview|century park|belvedere|coliseum|southgate/i },
  metro: { name: 'Metro Line', short: 'M', color: '#e0393e', textColor: '#ffffff', match: /\bmetro\b/i, stations: /nait|blatchford|kingsway|macewan/i },
  valley: { name: 'Valley Line', short: 'V', color: '#2fa35f', textColor: '#ffffff', match: /\bvalley\b/i, stations: /mill woods|muttart|bonnie doon|davies|strathearn|holyrood|quarters/i },
};
const EXTRA_COLORS = ['#8e5bd8', '#e08a1e', '#1aa3a3', '#c2456e'];
/** GTFS route types that can be light rail: tram, subway/metro, rail, monorail, and the extended tram/urban-rail codes */
const RAIL_TYPES = new Set([0, 1, 2, 12, 400, 401, 402, 403, 404, 405, 900, 901, 902, 903, 904, 905, 906]);
const RAIL_NAMES = /\b(capital|metro|valley)\s+line\b|\blrt\b/i;

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? 'public/data/lrt.json';

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});

async function main() {
  if (argv.includes('--if-missing')) {
    try {
      await access(OUT);
      console.log(`${OUT} already exists – skipping the download (run \`npm run data\` to refresh it).`);
      return;
    } catch {
      /* not there yet: build it */
    }
  }
  const t0 = Date.now();
  const local = arg('--file');
  let source;
  if (local) {
    source = { buf: await readFile(local), url: local, lastModified: undefined };
    console.log(`Reading ${local}`);
  } else {
    source = await download();
  }
  const zip = await JSZip.loadAsync(source.buf);
  const data = await build(zip, source);
  const json = JSON.stringify(data);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT + '.tmp', json);
  await rename(OUT + '.tmp', OUT);
  const perLine = data.lines.map((l) => `${l.name} ${data.trips.filter((t) => data.patterns[t[1]].line === l.id).length}`).join(', ');
  console.log(`✔ ${OUT}: ${(json.length / 1024).toFixed(0)} KB · ${data.stations.length} stations · ${data.patterns.length} patterns · ${data.trips.length} trips (${perLine}) · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/* ------------------------------------------------------------------ download */

async function download() {
  const urls = process.env.GTFS_URL ? [process.env.GTFS_URL] : FEED_URLS;
  let last;
  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Downloading ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        const res = await fetch(url, { headers: { 'user-agent': 'edmonton-lrt-live/2 (+GitHub Actions)' }, signal: AbortSignal.timeout(180_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1024 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('the response is not a zip file');
        console.log(`  ${(buf.length / 1048576).toFixed(1)} MB`);
        return { buf, url, lastModified: res.headers.get('last-modified') ?? undefined };
      } catch (err) {
        last = err;
        console.warn(`  failed: ${err.message}`);
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw new Error(`Could not download the GTFS feed (${last?.message}). Set GTFS_URL or pass --file.`);
}

/* ------------------------------------------------------------------ CSV */

function findFile(zip, name) {
  const want = name.toLowerCase();
  return Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().split('/').pop() === want) ?? null;
}

/** RFC 4180 line split (quoted fields with commas and doubled quotes; GTFS feeds do not put line breaks in fields) */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Streams a GTFS table row by row: fn(cells, col) where col(name) gives the column index (-1 if absent). */
async function eachRow(zip, name, fn, { required = true } = {}) {
  const file = findFile(zip, name);
  if (!file) {
    if (required) throw new Error(`${name} is missing from the feed`);
    return false;
  }
  const rl = createInterface({ input: file.nodeStream('nodebuffer'), crlfDelay: Infinity });
  let index = null;
  const col = (n) => index.get(n) ?? -1;
  for await (const raw of rl) {
    if (index === null) {
      index = new Map(splitCsv(raw.replace(/^﻿/, '')).map((h, i) => [h.trim(), i]));
      continue;
    }
    if (!raw.trim()) continue;
    fn(splitCsv(raw), col);
  }
  return true;
}
const cell = (c, i) => (i >= 0 && c[i] != null ? c[i].trim() : '');

function parseTime(s) {
  if (!s) return NaN;
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0) : NaN;
}
const fmtTime = (t) => [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((v) => String(v).padStart(2, '0')).join(':');

/* ------------------------------------------------------------------ geometry (metres on a local plane) */

let LAT0 = 53.54;
let LON0 = -113.49;
const KX = () => 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110574;
const xy = (lon, lat) => [(lon - LON0) * KX(), (lat - LAT0) * KY];

function segProject(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + dx * t - p[0];
  const y = a[1] + dy * t - p[1];
  return { d: Math.hypot(x, y), t };
}

/** Douglas–Peucker on [lon,lat] points, tolerance in metres */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const P = pts.map(([lon, lat]) => xy(lon, lat));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segProject(P[a], P[b], P[i]).d;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Positions of stops along a shape, in order: vertex index + fraction, never going backwards. */
function projectStops(shape, stops) {
  const out = [];
  let from = 0;
  for (const p of stops) {
    let best = Infinity;
    let pos = from;
    for (let i = Math.floor(from); i < shape.length - 1; i++) {
      const r = segProject(shape[i], shape[i + 1], p);
      const at = i + r.t;
      if (at + 1e-9 < from) continue;
      if (r.d < best - 1e-6) {
        best = r.d;
        pos = at;
      } else if (best < 40 && r.d > best + 1500) break; // found it and moved well past
    }
    out.push(pos);
    from = pos;
  }
  return out;
}

/** mean distance (m) between each stop and the point it was placed at on the shape */
function fitError(shape, at, stops) {
  let sum = 0;
  stops.forEach((p, k) => {
    const i = Math.min(Math.floor(at[k]), shape.length - 2);
    const t = at[k] - i;
    const x = shape[i][0] + (shape[i + 1][0] - shape[i][0]) * t;
    const y = shape[i][1] + (shape[i + 1][1] - shape[i][1]) * t;
    sum += Math.hypot(x - p[0], y - p[1]);
  });
  return sum / stops.length;
}

function cumulative(shape) {
  const cum = [0];
  for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]));
  return cum;
}
const distAt = (cum, at) => {
  const i = Math.min(Math.floor(at), cum.length - 2);
  return cum[i] + (cum[i + 1] - cum[i]) * (at - i);
};

/* ------------------------------------------------------------------ names */

/** "Churchill Station NB" → "Churchill", "Muttart Stop" → "Muttart" */
function cleanName(name) {
  const n = name
    .replace(/\s*\((?:NB|SB|EB|WB|north|south|east|west|platform)[^)]*\)\s*$/i, '')
    .replace(/\s+(?:NB|SB|EB|WB|northbound|southbound|eastbound|westbound)\b.*$/i, '')
    .replace(/\s+(?:LRT\s+)?(?:station|stop)\b.*$/i, '')
    .replace(/\s+platform\s*\w*$/i, '')
    .trim();
  return n || name.trim();
}
const normName = (n) => cleanName(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'line';

/* ------------------------------------------------------------------ timing */

/**
 * Cleans one trip's stop times: fills gaps, smooths minute-rounded times by distance
 * (rounded feeds otherwise make trains lurch between 1- and 2-minute hops) and gives
 * every intermediate stop a short dwell. The trip still starts and ends on time.
 */
function tidyTimes(A, D, dist) {
  const n = A.length;
  for (let k = 0; k < n; k++) {
    if (isNaN(A[k])) A[k] = D[k];
    if (isNaN(D[k])) D[k] = A[k];
  }
  // interpolate missing (non-timepoint) stops by distance
  for (let k = 0; k < n; k++) {
    if (!isNaN(A[k])) continue;
    let a = k - 1;
    while (a >= 0 && isNaN(D[a])) a--;
    let b = k + 1;
    while (b < n && isNaN(A[b])) b++;
    if (a < 0 || b >= n) return null;
    const f = (dist[k] - dist[a]) / Math.max(1, dist[b] - dist[a]);
    A[k] = D[k] = Math.round(D[a] + (A[b] - D[a]) * f);
  }
  const wholeMinutes = A.every((t) => t % 60 === 0) && D.every((t) => t % 60 === 0);
  const arr = A.slice();
  const dep = D.slice();
  if (wholeMinutes && n >= 3) {
    const dwell = A.map((a, k) => (k === 0 || k === n - 1 ? 0 : D[k] - a >= 60 ? D[k] - a : 25));
    const total = A[n - 1] - D[0];
    const run = total - dwell.reduce((s, v) => s + v, 0);
    if (run > 30 * (n - 1)) {
      const w = [];
      for (let k = 0; k < n - 1; k++) w.push(dist[k + 1] - dist[k] + 300); // + time lost braking and accelerating
      const wsum = w.reduce((s, v) => s + v, 0);
      let t = D[0];
      for (let k = 1; k < n; k++) {
        t += (run * w[k - 1]) / wsum;
        arr[k] = Math.max(A[k] - 45, Math.min(A[k] + 45, t));
        dep[k] = k === n - 1 ? arr[k] : arr[k] + dwell[k];
        t = arr[k] + dwell[k];
      }
      arr[n - 1] = dep[n - 1] = A[n - 1];
    }
  } else {
    for (let k = 1; k < n - 1; k++) {
      if (D[k] - A[k] >= 10) continue;
      const half = Math.min(12, 0.2 * (A[k] - D[k - 1]), 0.2 * (A[k + 1] - D[k]));
      if (half > 0) {
        arr[k] = A[k] - half;
        dep[k] = D[k] + half;
      }
    }
  }
  // never run backwards, always leave at least 20 s between stops
  for (let k = 1; k < n; k++) {
    arr[k] = Math.max(arr[k], dep[k - 1] + 20);
    dep[k] = Math.max(dep[k], arr[k]);
  }
  return { arr: arr.map(Math.round), dep: dep.map(Math.round) };
}

/* ------------------------------------------------------------------ build */

async function build(zip, source) {
  // agency + feed info
  let timezone = 'America/Edmonton';
  await eachRow(zip, 'agency.txt', (c, col) => {
    const tz = cell(c, col('agency_timezone'));
    if (tz) timezone = tz;
  }, { required: false });
  const feed = {};
  await eachRow(zip, 'feed_info.txt', (c, col) => {
    feed.publisher = cell(c, col('feed_publisher_name')) || undefined;
    feed.version = cell(c, col('feed_version')) || undefined;
    feed.start = cell(c, col('feed_start_date')) || undefined;
    feed.end = cell(c, col('feed_end_date')) || undefined;
  }, { required: false });

  // routes: everything that runs on rails
  const routes = [];
  await eachRow(zip, 'routes.txt', (c, col) => {
    routes.push({
      id: cell(c, col('route_id')),
      type: Number(cell(c, col('route_type'))),
      short: cell(c, col('route_short_name')),
      long: cell(c, col('route_long_name')),
      desc: cell(c, col('route_desc')),
      color: cell(c, col('route_color')),
      text: cell(c, col('route_text_color')),
    });
  });
  let rail = routes.filter((r) => RAIL_TYPES.has(r.type));
  if (!rail.length) rail = routes.filter((r) => RAIL_NAMES.test(`${r.short} ${r.long} ${r.desc}`));
  if (!rail.length) {
    const types = {};
    for (const r of routes) types[r.type] = (types[r.type] ?? 0) + 1;
    throw new Error(`No light-rail routes found among ${routes.length} routes (route_type counts: ${JSON.stringify(types)})`);
  }
  const railIds = new Set(rail.map((r) => r.id));
  console.log(`  rail routes: ${rail.map((r) => `${r.id} “${r.long || r.short}”`).join(', ')}`);

  // trips on those routes
  const trips = new Map();
  await eachRow(zip, 'trips.txt', (c, col) => {
    const route = cell(c, col('route_id'));
    if (!railIds.has(route)) return;
    const id = cell(c, col('trip_id'));
    trips.set(id, {
      id,
      route,
      service: cell(c, col('service_id')),
      dir: Number(cell(c, col('direction_id')) || 0),
      shape: cell(c, col('shape_id')),
      headsign: cell(c, col('trip_headsign')),
      block: cell(c, col('block_id')),
      stops: [],
    });
  });

  // stop times (the biggest file by far: streamed, only LRT rows kept)
  await eachRow(zip, 'stop_times.txt', (c, col) => {
    const t = trips.get(cell(c, col('trip_id')));
    if (!t) return;
    t.stops.push({ seq: Number(cell(c, col('stop_sequence'))), stop: cell(c, col('stop_id')), arr: parseTime(cell(c, col('arrival_time'))), dep: parseTime(cell(c, col('departure_time'))) });
  });

  // frequency-based trips are expanded into individual runs
  const freq = [];
  await eachRow(zip, 'frequencies.txt', (c, col) => {
    const id = cell(c, col('trip_id'));
    if (trips.has(id)) freq.push({ id, from: parseTime(cell(c, col('start_time'))), to: parseTime(cell(c, col('end_time'))), every: Number(cell(c, col('headway_secs'))) });
  }, { required: false });
  for (const f of freq) {
    const tpl = trips.get(f.id);
    if (!tpl || !(f.every > 0)) continue;
    trips.delete(f.id);
    tpl.stops.sort((a, b) => a.seq - b.seq);
    const base = tpl.stops[0].dep;
    for (let t = f.from; t < f.to; t += f.every) {
      const id = `${f.id}@${fmtTime(t)}`;
      trips.set(id, { ...tpl, id, stops: tpl.stops.map((s) => ({ ...s, arr: s.arr - base + t, dep: s.dep - base + t })) });
    }
  }

  // stops (with their parent stations)
  const stops = new Map();
  await eachRow(zip, 'stops.txt', (c, col) => {
    const id = cell(c, col('stop_id'));
    stops.set(id, { id, name: cell(c, col('stop_name')), lat: Number(cell(c, col('stop_lat'))), lon: Number(cell(c, col('stop_lon'))), parent: cell(c, col('parent_station')) });
  });

  for (const [id, t] of trips) {
    t.stops.sort((a, b) => a.seq - b.seq);
    t.stops = t.stops.filter((s) => stops.has(s.stop));
    if (t.stops.length < 2) trips.delete(id);
  }
  if (!trips.size) throw new Error('The rail routes have no trips with stop times');

  // which line is each route? by name first, then by the stations it serves
  const routeStations = new Map();
  for (const t of trips.values()) {
    const set = routeStations.get(t.route) ?? new Set();
    for (const s of t.stops) set.add(stops.get(s.stop).name);
    routeStations.set(t.route, set);
  }
  const lines = new Map();
  const routeLine = new Map();
  let extra = 0;
  for (const r of rail) {
    if (!routeStations.has(r.id)) continue;
    const text = `${r.short} ${r.long} ${r.desc}`;
    const names = [...routeStations.get(r.id)].join(' | ');
    let id = Object.keys(KNOWN_LINES).find((k) => KNOWN_LINES[k].match.test(text));
    if (!id) {
      const score = Object.entries(KNOWN_LINES).map(([k, v]) => [k, (names.match(new RegExp(v.stations.source, 'gi')) ?? []).length]).sort((a, b) => b[1] - a[1]);
      if (score[0][1] > 0) id = score[0][0];
    }
    let meta;
    if (id) meta = KNOWN_LINES[id];
    else {
      id = slug(r.long || r.short || r.id);
      meta = {
        name: r.long || r.short || id,
        short: (r.short || r.long || id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'L',
        color: /^[0-9a-f]{6}$/i.test(r.color) ? `#${r.color}` : EXTRA_COLORS[extra++ % EXTRA_COLORS.length],
        textColor: /^[0-9a-f]{6}$/i.test(r.text) ? `#${r.text}` : '#ffffff',
      };
    }
    routeLine.set(r.id, id);
    if (!lines.has(id)) lines.set(id, { id, name: meta.name, short: meta.short, color: meta.color, textColor: meta.textColor, routeIds: [] });
    lines.get(id).routeIds.push(r.id);
  }
  const order = (id) => (id in KNOWN_LINES ? Object.keys(KNOWN_LINES).indexOf(id) : 9);
  const lineList = [...lines.values()].sort((a, b) => order(a.id) - order(b.id) || a.name.localeCompare(b.name));

  // centre of the network for the local metric plane
  {
    let la = 0;
    let lo = 0;
    let n = 0;
    for (const t of trips.values())
      for (const s of t.stops) {
        const p = stops.get(s.stop);
        la += p.lat;
        lo += p.lon;
        n++;
      }
    LAT0 = la / n;
    LON0 = lo / n;
  }

  // stations: platforms grouped by parent station, else by cleaned name
  const stationIndex = new Map();
  const stations = [];
  const stationOf = (stopId) => {
    const s = stops.get(stopId);
    const parent = s.parent && stops.has(s.parent) ? stops.get(s.parent) : null;
    const key = parent ? `P:${parent.id}` : `N:${normName(s.name)}`;
    let idx = stationIndex.get(key);
    if (idx === undefined) {
      idx = stations.length;
      stationIndex.set(key, idx);
      stations.push({ id: parent ? parent.id : s.id, name: cleanName((parent ?? s).name), parent, members: new Map(), lines: new Set() });
    }
    stations[idx].members.set(s.id, s);
    return idx;
  };

  // shapes in use
  const shapeIds = new Set([...trips.values()].map((t) => t.shape).filter(Boolean));
  const rawShapes = new Map();
  await eachRow(zip, 'shapes.txt', (c, col) => {
    const id = cell(c, col('shape_id'));
    if (!shapeIds.has(id)) return;
    const list = rawShapes.get(id) ?? [];
    list.push([Number(cell(c, col('shape_pt_sequence'))), Number(cell(c, col('shape_pt_lon'))), Number(cell(c, col('shape_pt_lat')))]);
    rawShapes.set(id, list);
  }, { required: false });

  const shapes = [];
  const shapeIndex = new Map();
  const shapeXY = [];
  const addShape = (id, line, lonlat) => {
    const pts = [];
    for (const p of lonlat) {
      const q = pts[pts.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) pts.push(p);
    }
    if (pts.length < 2) return -1;
    const simple = simplify(pts, 0.6);
    const idx = shapes.length;
    shapes.push({ id, line, coords: simple.flatMap(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]) });
    const P = simple.map(([lon, lat]) => xy(+lon.toFixed(6), +lat.toFixed(6)));
    shapeXY.push({ P, cum: cumulative(P) });
    shapeIndex.set(id, idx);
    return idx;
  };

  // services in use
  const serviceIds = new Set([...trips.values()].map((t) => t.service));
  const services = new Map();
  const svc = (id) => {
    if (!services.has(id)) services.set(id, { id, days: '0000000', start: '99999999', end: '00000000', add: [], remove: [] });
    return services.get(id);
  };
  await eachRow(zip, 'calendar.txt', (c, col) => {
    const id = cell(c, col('service_id'));
    if (!serviceIds.has(id)) return;
    const s = svc(id);
    s.days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => (cell(c, col(d)) === '1' ? '1' : '0')).join('');
    s.start = cell(c, col('start_date'));
    s.end = cell(c, col('end_date'));
  }, { required: false });
  await eachRow(zip, 'calendar_dates.txt', (c, col) => {
    const id = cell(c, col('service_id'));
    if (!serviceIds.has(id)) return;
    const s = svc(id);
    const date = cell(c, col('date'));
    (cell(c, col('exception_type')) === '2' ? s.remove : s.add).push(date);
  }, { required: false });
  for (const id of serviceIds) svc(id);

  // patterns (same line, track and stop list) and per-trip timing profiles
  const patterns = [];
  const patternIndex = new Map();
  const profiles = [];
  const profileIndex = new Map();
  const blocks = [];
  const blockIndex = new Map();
  const serviceList = [...services.values()].sort((a, b) => a.id.localeCompare(b.id));
  const serviceIdx = new Map(serviceList.map((s, i) => [s.id, i]));
  const rows = [];
  let dropped = 0;

  for (const t of trips.values()) {
    const line = routeLine.get(t.route);
    if (!line) continue;
    const st = t.stops.map((s) => stationOf(s.stop));
    for (const i of st) stations[i].lines.add(line);
    const stopXY = t.stops.map((s) => {
      const p = stops.get(s.stop);
      return xy(p.lon, p.lat);
    });
    let si = -1;
    if (t.shape && rawShapes.has(t.shape)) {
      si = shapeIndex.get(t.shape) ?? addShape(t.shape, line, rawShapes.get(t.shape).sort((a, b) => a[0] - b[0]).map((p) => [p[1], p[2]]));
    }
    if (si < 0) {
      const key = `auto:${line}:${t.stops.map((s) => s.stop).join('-')}`;
      si = shapeIndex.get(key) ?? addShape(key, line, t.stops.map((s) => [stops.get(s.stop).lon, stops.get(s.stop).lat]));
      if (si < 0) {
        dropped++;
        continue;
      }
    }
    const headsign = t.headsign ? cleanName(t.headsign) : stations[st[st.length - 1]].name;
    const pkey = `${line}|${si}|${t.stops.map((s) => s.stop).join(',')}|${headsign}`;
    let pi = patternIndex.get(pkey);
    if (pi === undefined) {
      let { P, cum } = shapeXY[si];
      let at = projectStops(P, stopXY);
      // a shape drawn against the direction of travel would squash every stop onto one end: try it reversed
      if (fitError(P, at, stopXY) > 60) {
        const c = shapes[si].coords;
        const rev = [];
        for (let i = c.length - 2; i >= 0; i -= 2) rev.push([c[i], c[i + 1]]);
        const ri = shapeIndex.get(`${shapes[si].id}:rev`) ?? addShape(`${shapes[si].id}:rev`, line, rev);
        const rat = projectStops(shapeXY[ri].P, stopXY);
        if (fitError(shapeXY[ri].P, rat, stopXY) < fitError(P, at, stopXY)) {
          si = ri;
          ({ P, cum } = shapeXY[ri]);
          at = rat;
        }
      }
      pi = patterns.length;
      patternIndex.set(pkey, pi);
      patterns.push({ id: `p${pi}`, line, dir: t.dir, headsign, shape: si, stations: st, at: at.map((v) => +v.toFixed(4)), _dist: at.map((v) => distAt(cum, v)) });
    }
    const p = patterns[pi];
    const times = tidyTimes(t.stops.map((s) => s.arr), t.stops.map((s) => s.dep), p._dist);
    if (!times) {
      dropped++;
      continue;
    }
    const start = times.dep[0];
    const prof = [];
    for (let k = 0; k < times.arr.length; k++) prof.push(times.arr[k] - start, times.dep[k] - start);
    const key = prof.join(',');
    let fi = profileIndex.get(key);
    if (fi === undefined) {
      fi = profiles.length;
      profileIndex.set(key, fi);
      profiles.push(prof);
    }
    let bi = -1;
    if (t.block) {
      bi = blockIndex.get(t.block) ?? -1;
      if (bi < 0) {
        bi = blocks.length;
        blockIndex.set(t.block, bi);
        blocks.push(t.block);
      }
    }
    rows.push([t.id, pi, serviceIdx.get(t.service), start, fi, bi]);
  }
  if (dropped) console.warn(`  ${dropped} trips skipped (unusable stop times or shape)`);
  if (!rows.length) throw new Error('No usable LRT trips were found');
  rows.sort((a, b) => a[3] - b[3] || a[1] - b[1]);

  for (const l of lineList) {
    const n = rows.filter((r) => patterns[r[1]].line === l.id).length;
    if (!n) console.warn(`  warning: ${l.name} has no trips`);
  }

  // drop lines that ended up with no trips
  const usedLines = new Set(patterns.map((p) => p.line));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { url: source.url, lastModified: source.lastModified, feedVersion: feed.version, feedStart: feed.start, feedEnd: feed.end, publisher: feed.publisher },
    timezone,
    lines: lineList.filter((l) => usedLines.has(l.id)),
    stations: stations.map((s) => {
      const pts = s.parent && Number.isFinite(s.parent.lat) && s.parent.lat !== 0 ? [s.parent] : [...s.members.values()];
      return {
        id: s.id,
        name: s.name,
        lon: +(pts.reduce((a, p) => a + p.lon, 0) / pts.length).toFixed(6),
        lat: +(pts.reduce((a, p) => a + p.lat, 0) / pts.length).toFixed(6),
        lines: [...s.lines].sort((a, b) => order(a) - order(b)),
        stopIds: [...s.members.keys()],
      };
    }),
    shapes,
    patterns: patterns.map(({ _dist, ...p }) => p),
    services: serviceList,
    profiles,
    blocks,
    trips: rows,
  };
}
