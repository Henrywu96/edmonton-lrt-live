import type { FeatureCollection, LineString, Point } from 'geojson';
import { LINE_OFFSET, LINE_STOCK, UNDERGROUND, type StockKey } from '../config';
import type { LrtData } from '../types';
import { LocalFrame, Path, type PathPoint } from './geo';

export interface Line {
  id: string;
  name: string;
  short: string;
  color: string;
  textColor: string;
  stock: StockKey;
  order: number;
}

export interface Station {
  idx: number;
  id: string;
  name: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  lines: Line[];
  /** stations sharing this name (e.g. the Capital/Metro and Valley Line stops at Churchill) */
  group: number[];
}

export interface Shape {
  idx: number;
  id: string;
  line: Line;
  path: Path;
  /** underground stretches as [from, to] distances, sorted */
  ug: [number, number][];
}

export interface Pattern {
  idx: number;
  id: string;
  line: Line;
  dir: number;
  headsign: string;
  shape: Shape;
  stations: Station[];
  /** distance of each stop along the shape */
  dist: Float64Array;
  /** travel direction at each stop (unit vector) */
  hx: Float32Array;
  hy: Float32Array;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameIs = (name: string, key: string) => {
  const n = norm(name);
  return n === key || n.startsWith(key + ' ');
};

export class Network {
  readonly frame: LocalFrame;
  readonly lines: Line[];
  readonly lineById = new Map<string, Line>();
  readonly stations: Station[];
  readonly shapes: Shape[];
  readonly patterns: Pattern[];
  readonly bounds: [[number, number], [number, number]];

  constructor(data: LrtData) {
    // origin: middle of the stations' extent
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const st of data.stations) {
      w = Math.min(w, st.lon);
      e = Math.max(e, st.lon);
      s = Math.min(s, st.lat);
      n = Math.max(n, st.lat);
    }
    this.bounds = [
      [w, s],
      [e, n],
    ];
    const frame = (this.frame = new LocalFrame((w + e) / 2, (s + n) / 2));

    this.lines = data.lines.map((l, i) => ({
      id: l.id,
      name: l.name,
      short: l.short,
      color: l.color,
      textColor: l.textColor,
      stock: LINE_STOCK[l.id] ?? (/valley/i.test(l.id) ? 'flexity' : 'u2'),
      order: i,
    }));
    for (const l of this.lines) this.lineById.set(l.id, l);
    const lineOf = (id: string) => this.lineById.get(id) ?? this.lines[0];

    this.stations = data.stations.map((st, idx) => {
      const p = frame.toLocal(st.lon, st.lat);
      return { idx, id: st.id, name: st.name, lon: st.lon, lat: st.lat, x: p.x, y: p.y, lines: st.lines.map(lineOf), group: [idx] };
    });
    const byName = new Map<string, number[]>();
    for (const st of this.stations) {
      const k = norm(st.name);
      byName.set(k, [...(byName.get(k) ?? []), st.idx]);
    }
    for (const st of this.stations) st.group = byName.get(norm(st.name)) ?? [st.idx];

    this.shapes = data.shapes.map((sh, idx) => {
      const m = sh.coords.length / 2;
      const px = new Float64Array(m);
      const py = new Float64Array(m);
      const q = { x: 0, y: 0 };
      for (let i = 0; i < m; i++) {
        frame.toLocal(sh.coords[2 * i], sh.coords[2 * i + 1], q);
        px[i] = q.x;
        py[i] = q.y;
      }
      return { idx, id: sh.id, line: lineOf(sh.line), path: new Path(px, py), ug: [] };
    });

    const pt: PathPoint = { x: 0, y: 0, tx: 0, ty: 0 };
    this.patterns = data.patterns.map((p, idx) => {
      const shape = this.shapes[p.shape];
      const dist = Float64Array.from(p.at, (a) => shape.path.distAtVertex(a));
      for (let k = 1; k < dist.length; k++) dist[k] = Math.max(dist[k], dist[k - 1]);
      const hx = new Float32Array(dist.length);
      const hy = new Float32Array(dist.length);
      dist.forEach((d, k) => {
        shape.path.at(d, pt);
        hx[k] = pt.tx;
        hy[k] = pt.ty;
      });
      return { idx, id: p.id, line: lineOf(p.line), dir: p.dir, headsign: p.headsign, shape, stations: p.stations.map((i) => this.stations[i]), dist, hx, hy };
    });

    this.markUnderground();
  }

  /** underground stretches of each shape, worked out from the stations either side of each link */
  private markUnderground() {
    const ugStation = (st: Station) => UNDERGROUND.stations.some((k) => nameIs(st.name, k));
    const ranges = new Map<Shape, [number, number][]>();
    for (const p of this.patterns) {
      if (!UNDERGROUND.lines.includes(p.line.id)) continue;
      const list = ranges.get(p.shape) ?? [];
      const n = p.stations.length;
      if (ugStation(p.stations[0])) list.push([-1e9, p.dist[0]]);
      if (ugStation(p.stations[n - 1])) list.push([p.dist[n - 1], 1e9]);
      for (let k = 0; k < n - 1; k++) {
        const A = p.stations[k];
        const B = p.stations[k + 1];
        const a = p.dist[k];
        const b = p.dist[k + 1];
        const len = b - a;
        const ua = ugStation(A);
        const ub = ugStation(B);
        if (ua && ub) {
          let open: [number, number] | null = null;
          for (const [s1, s2, f1, f2] of UNDERGROUND.open) {
            if (nameIs(A.name, s1) && nameIs(B.name, s2)) open = [f1, f2];
            else if (nameIs(A.name, s2) && nameIs(B.name, s1)) open = [1 - f2, 1 - f1];
          }
          if (open) list.push([a, a + open[0] * len], [a + open[1] * len, b]);
          else list.push([a, b]);
        } else if (ua) list.push([a, a + len * 0.5]);
        else if (ub) list.push([a + len * 0.5, b]);
      }
      ranges.set(p.shape, list);
    }
    for (const [shape, list] of ranges) {
      list.sort((u, v) => u[0] - v[0]);
      const merged: [number, number][] = [];
      for (const r of list) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      shape.ug = merged;
    }
  }

  isUnderground(shape: Shape, d: number): boolean {
    for (const r of shape.ug) if (d >= r[0] && d <= r[1]) return true;
    return false;
  }

  /**
   * One drawable set of route lines per line: the longest track first, then only the parts of
   * other shapes not already drawn (the two directions of a line usually share one polyline).
   * Lines run "southwards" so the side-by-side offset puts Capital and Metro on opposite sides.
   */
  routeGeoJSON(): FeatureCollection<LineString, { line: string; color: string; ug: boolean; off: number }> {
    const features: FeatureCollection<LineString, { line: string; color: string; ug: boolean; off: number }>['features'] = [];
    const CELL = 30;
    const SAMPLE = 8;
    for (const line of this.lines) {
      const covered = new Set<string>();
      const cellKey = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const isCovered = (x: number, y: number) => {
        const cx = Math.floor(x / CELL);
        const cy = Math.floor(y / CELL);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (covered.has(`${cx + i},${cy + j}`)) return true;
        return false;
      };
      const shapes = this.shapes.filter((s) => s.line === line).sort((a, b) => b.path.L - a.path.L);
      const pt: PathPoint = { x: 0, y: 0, tx: 0, ty: 0 };
      for (const shape of shapes) {
        const P = shape.path;
        const count = Math.max(2, Math.ceil(P.L / SAMPLE) + 1);
        const xs: number[] = [];
        const ys: number[] = [];
        const ds: number[] = [];
        const free: boolean[] = [];
        for (let i = 0; i < count; i++) {
          const d = (P.L * i) / (count - 1);
          P.at(d, pt);
          xs.push(pt.x);
          ys.push(pt.y);
          ds.push(d);
          free.push(!isCovered(pt.x, pt.y));
        }
        // runs of uncovered samples, one sample of overlap at each end so pieces join up
        let i = 0;
        while (i < count) {
          if (!free[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < count && free[j + 1]) j++;
          const a = Math.max(0, i - 1);
          const b = Math.min(count - 1, j + 1);
          if ((b - a) * SAMPLE >= 40 || shapes.length === 1) this.pushRun(features, line, shape, xs, ys, ds, a, b);
          i = j + 1;
        }
        for (let k = 0; k < count; k++) covered.add(cellKey(xs[k], ys[k]));
      }
    }
    return { type: 'FeatureCollection', features };
  }

  private pushRun(
    out: FeatureCollection<LineString, { line: string; color: string; ug: boolean; off: number }>['features'],
    line: Line,
    shape: Shape,
    xs: number[],
    ys: number[],
    ds: number[],
    a: number,
    b: number,
  ) {
    let idx: number[] = [];
    for (let k = a; k <= b; k++) idx.push(k);
    if (ys[b] - ys[a] > 0) idx = idx.reverse(); // run southwards
    let cur: number[] = [];
    let curUg: boolean | null = null;
    const flush = () => {
      if (cur.length >= 2) {
        out.push({
          type: 'Feature',
          properties: { line: line.id, color: line.color, ug: !!curUg, off: LINE_OFFSET[line.id] ?? 0 },
          geometry: { type: 'LineString', coordinates: cur.map((k) => this.frame.toLngLat(xs[k], ys[k])) },
        });
      }
    };
    for (const k of idx) {
      const ug = this.isUnderground(shape, ds[k]);
      if (curUg !== null && ug !== curUg) {
        cur.push(k);
        flush();
        cur = [k];
      } else cur.push(k);
      curUg = ug;
    }
    flush();
  }

  stationGeoJSON(): FeatureCollection<Point, { idx: number; name: string; n: number; color: string }> {
    return {
      type: 'FeatureCollection',
      features: this.stations.map((st) => ({
        type: 'Feature',
        properties: { idx: st.idx, name: st.name, n: st.lines.length, color: st.lines.length === 1 ? st.lines[0].color : '#1d2633' },
        geometry: { type: 'Point', coordinates: [st.lon, st.lat] },
      })),
    };
  }
}
