import { ARR_DWELL, PRE_SHOW } from '../config';
import type { LrtData } from '../types';
import type { Line, Network, Pattern } from './network';
import { addDays, weekdayOf, type Zone } from './time';

/**
 * Turns the GTFS timetable into trains. For a service date it collects the trips that run,
 * links them into vehicles (by GTFS block_id when the feed has them, otherwise by turning
 * trains back at the terminus first-in-first-out), and answers "where is every train at
 * time t" with a binary search per vehicle — cheap enough to run every animation frame.
 */

export interface TripRun {
  id: string;
  pattern: Pattern;
  /** first departure, seconds after service-day midnight */
  start: number;
  /** [arr0, dep0, arr1, dep1, …] seconds after `start` */
  t: Int32Array;
  /** arrival at the last stop, seconds after service-day midnight */
  end: number;
  block: number;
  vehicle: Vehicle | null;
}

export type SpanKind = 'standby' | 'trip' | 'arrived';
interface Span {
  a: number;
  b: number;
  kind: SpanKind;
  trip: TripRun;
  hint: number;
}

export interface Vehicle {
  /** unique across days: "<date>:<id>" */
  key: string;
  /** short label, e.g. C07 */
  id: string;
  line: Line;
  trips: TripRun[];
  spans: Span[];
  plan: DayPlan;
  st: TrainState;
}

export type Mode = 'standby' | 'stop' | 'run' | 'arrived';
export interface TrainState {
  v: Vehicle;
  mode: Mode;
  trip: TripRun;
  /** stop index: where the train is (standby/stop/arrived) or the stop it just left (run) */
  k: number;
  /** distance along the trip's shape */
  dist: number;
  /** 0…1 progress between stop k and k+1 while running */
  u: number;
  /** metres per second */
  speed: number;
  /** service seconds of the next event: departure, or arrival at the next stop */
  nextT: number;
  /** service seconds of this state (in the vehicle's own plan) */
  t: number;
}

interface StopEvent {
  trip: TripRun;
  k: number;
  arr: number;
  dep: number;
  hx: number;
  hy: number;
}

export interface DayPlan {
  /** the calendar date this plan is for (YYYYMMDD) */
  key: string;
  /** the date whose services were used (differs when the feed does not cover `key`) */
  serviceKey: string;
  /** epoch ms of this date's service-day midnight */
  base: number;
  trips: TripRun[];
  vehicles: Vehicle[];
  byKey: Map<string, Vehicle>;
  events: Map<number, StopEvent[]>;
  special: boolean;
  firstDep: number;
  lastArr: number;
}

export interface Departure {
  ms: number;
  trip: TripRun;
  vehicle: Vehicle | null;
}
export interface DepartureGroup {
  line: Line;
  headsign: string;
  items: Departure[];
}

/* speed profile between stops: ease out of the platform, cruise, ease in (acceleration changes smoothly) */
const PA = 0.22;
const PB = 0.26;
const PV = 1 / (1 - PA / 2 - PB / 2);
const easeIn = (x: number) => x * x * x - (x * x * x * x) / 2; // integral of smoothstep
const smooth = (x: number) => x * x * (3 - 2 * x);
export function prof(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < PA) return PV * PA * easeIn(u / PA);
  if (u < 1 - PB) return PV * (PA / 2 + (u - PA));
  return 1 - PV * PB * easeIn((1 - u) / PB);
}
function profSpeed(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  if (u < PA) return PV * smooth(u / PA);
  if (u < 1 - PB) return PV;
  return PV * smooth((1 - u) / PB);
}

const MIN_GAP = 12;
const PLAN_CACHE = 5;

export class Schedule {
  private readonly profiles: Int32Array[];
  private readonly plans = new Map<string, DayPlan>();
  readonly rangeStart: string;
  readonly rangeEnd: string;

  constructor(
    private readonly data: LrtData,
    private readonly net: Network,
    readonly zone: Zone,
  ) {
    this.profiles = data.profiles.map((p) => Int32Array.from(p));
    let a = '99999999';
    let b = '00000000';
    for (const s of data.services) {
      const dates = [...s.add];
      if (s.days.includes('1')) dates.push(s.start, s.end);
      for (const d of dates) {
        if (d < a) a = d;
        if (d > b) b = d;
      }
    }
    this.rangeStart = a;
    this.rangeEnd = b;
  }

  /** indexes of the services running on a date */
  activeServices(key: string): Set<number> {
    const col = (weekdayOf(key) + 6) % 7; // GTFS days start on Monday
    const out = new Set<number>();
    this.data.services.forEach((s, i) => {
      let on = s.start <= key && key <= s.end && s.days[col] === '1';
      if (s.remove.includes(key)) on = false;
      if (s.add.includes(key)) on = true;
      if (on) out.add(i);
    });
    return out;
  }

  plan(key: string): DayPlan {
    let p = this.plans.get(key);
    if (p) {
      this.plans.delete(key); // keep most recently used last
      this.plans.set(key, p);
      return p;
    }
    p = this.build(key);
    this.plans.set(key, p);
    while (this.plans.size > PLAN_CACHE) this.plans.delete(this.plans.keys().next().value!);
    return p;
  }

  /** a plan for this date that is already built (for looking up vehicles by key) */
  cachedPlan(key: string): DayPlan | undefined {
    return this.plans.get(key);
  }

  private build(key: string): DayPlan {
    let serviceKey = key;
    let active = this.activeServices(key);
    // outside the feed's dates: borrow the same weekday from the nearest week it does cover
    if (!active.size && (key < this.rangeStart || key > this.rangeEnd)) {
      const step = key > this.rangeEnd ? -7 : 7;
      let k = key;
      for (let i = 0; i < 80; i++) {
        k = addDays(k, step);
        const a = this.activeServices(k);
        if (a.size) {
          serviceKey = k;
          active = a;
          break;
        }
      }
    }
    const col = (weekdayOf(serviceKey) + 6) % 7;
    const special = [...active].some((i) => {
      const s = this.data.services[i];
      return s.add.includes(serviceKey) && !(s.days[col] === '1' && s.start <= serviceKey && serviceKey <= s.end);
    });

    const plan: DayPlan = {
      key,
      serviceKey,
      base: this.zone.serviceBase(key),
      trips: [],
      vehicles: [],
      byKey: new Map(),
      events: new Map(),
      special,
      firstDep: Infinity,
      lastArr: -Infinity,
    };
    for (const row of this.data.trips) {
      if (!active.has(row[2])) continue;
      const t = this.profiles[row[4]];
      const trip: TripRun = { id: row[0], pattern: this.net.patterns[row[1]], start: row[3], t, end: row[3] + t[t.length - 2], block: row[5], vehicle: null };
      plan.trips.push(trip);
      plan.firstDep = Math.min(plan.firstDep, trip.start);
      plan.lastArr = Math.max(plan.lastArr, trip.end);
    }
    plan.trips.sort((a, b) => a.start - b.start);

    // every stop call, per station, for keeping platforms clear
    for (const trip of plan.trips) {
      const p = trip.pattern;
      p.stations.forEach((st, k) => {
        const list = plan.events.get(st.idx) ?? [];
        list.push({ trip, k, arr: trip.start + trip.t[2 * k], dep: trip.start + trip.t[2 * k + 1], hx: p.hx[k], hy: p.hy[k] });
        plan.events.set(st.idx, list);
      });
    }
    for (const list of plan.events.values()) list.sort((a, b) => a.arr - b.arr);

    this.makeVehicles(plan);
    for (const v of plan.vehicles) this.makeSpans(plan, v);
    return plan;
  }

  private makeVehicles(plan: DayPlan) {
    const chains: TripRun[][] = [];
    const withBlock = plan.trips.filter((t) => t.block >= 0).length;
    const loose: TripRun[] = [];
    if (plan.trips.length && withBlock >= plan.trips.length * 0.8) {
      const byBlock = new Map<number, TripRun[]>();
      for (const t of plan.trips) {
        if (t.block < 0) loose.push(t);
        else byBlock.set(t.block, [...(byBlock.get(t.block) ?? []), t]);
      }
      for (const list of byBlock.values()) {
        // a block should never overlap itself; if the data says otherwise, split it
        let cur: TripRun[] = [];
        for (const t of list) {
          if (cur.length && t.start < cur[cur.length - 1].end) {
            loose.push(t);
            continue;
          }
          cur.push(t);
        }
        chains.push(cur);
      }
    } else loose.push(...plan.trips);

    // no blocks: a train arriving at a terminus takes the next trip out of that station, first in first out
    if (loose.length) {
      loose.sort((a, b) => a.start - b.start);
      const pool = new Map<string, { chain: TripRun[]; ready: number }[]>();
      for (const t of loose) {
        const from = `${t.pattern.line.id}:${t.pattern.stations[0].group[0]}`;
        const q = pool.get(from) ?? [];
        let best = -1;
        for (let i = 0; i < q.length; i++) if (q[i].ready <= t.start && (best < 0 || q[i].ready < q[best].ready)) best = i;
        let chain: TripRun[];
        if (best >= 0) chain = q.splice(best, 1)[0].chain;
        else chains.push((chain = []));
        chain.push(t);
        const st = t.pattern.stations;
        const to = `${t.pattern.line.id}:${st[st.length - 1].group[0]}`;
        pool.set(from, q);
        pool.set(to, [...(pool.get(to) ?? []), { chain, ready: t.end + 120 }]);
      }
    }

    chains.sort((a, b) => a[0].start - b[0].start);
    const counters = new Map<string, number>();
    for (const trips of chains) {
      if (!trips.length) continue;
      const line = trips[0].pattern.line;
      const n = (counters.get(line.id) ?? 0) + 1;
      counters.set(line.id, n);
      const id = `${line.short}${String(n).padStart(2, '0')}`;
      const v: Vehicle = { key: `${plan.key}:${id}`, id, line, trips, spans: [], plan, st: null as unknown as TrainState };
      v.st = { v, mode: 'standby', trip: trips[0], k: 0, dist: 0, u: 0, speed: 0, nextT: 0, t: 0 };
      for (const t of trips) t.vehicle = v;
      plan.vehicles.push(v);
      plan.byKey.set(v.key, v);
    }
  }

  /** is another train using the same side of the platform? (travelling the same way through the station) */
  private clearFrom(plan: DayPlan, trip: TripRun, k: number, from: number, until: number): number {
    const st = trip.pattern.stations[k];
    const hx = trip.pattern.hx[k];
    const hy = trip.pattern.hy[k];
    let a = from;
    for (const idx of st.group) {
      for (const e of plan.events.get(idx) ?? []) {
        if (e.trip === trip || e.hx * hx + e.hy * hy < 0.3) continue;
        if (e.arr < until && e.dep + MIN_GAP > a) a = Math.max(a, e.dep + MIN_GAP);
      }
    }
    return Math.min(a, until);
  }
  private clearUntil(plan: DayPlan, trip: TripRun, from: number, until: number): number {
    const p = trip.pattern;
    const k = p.stations.length - 1;
    let b = until;
    for (const idx of p.stations[k].group) {
      for (const e of plan.events.get(idx) ?? []) {
        if (e.trip === trip || e.hx * p.hx[k] + e.hy * p.hy[k] < 0.3) continue;
        if (e.arr >= from && e.arr - MIN_GAP < b) b = Math.max(from + 5, e.arr - MIN_GAP);
      }
    }
    return b;
  }

  /** a vehicle's day: waiting on the platform, running each trip, standing after arrival; hidden in between */
  private makeSpans(plan: DayPlan, v: Vehicle) {
    const spans: Span[] = [];
    let free = -Infinity;
    v.trips.forEach((tr, i) => {
      const nx = v.trips[i + 1];
      const a = this.clearFrom(plan, tr, 0, Math.max(tr.start - PRE_SHOW, free), tr.start);
      if (a < tr.start) spans.push({ a, b: tr.start, kind: 'standby', trip: tr, hint: 0 });
      spans.push({ a: tr.start, b: tr.end, kind: 'trip', trip: tr, hint: 0 });
      let b = tr.end + ARR_DWELL;
      if (nx) b = Math.min(b, nx.start);
      b = this.clearUntil(plan, tr, tr.end, b);
      if (b > tr.end) spans.push({ a: tr.end, b, kind: 'arrived', trip: tr, hint: 0 });
      free = Math.max(b, tr.end);
    });
    v.spans = spans;
  }

  /** the vehicle's state at service time t of its plan, or null when it is out of sight */
  stateAt(v: Vehicle, t: number): TrainState | null {
    const S = v.spans;
    let lo = 0;
    let hi = S.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (S[m].a <= t) {
        idx = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    if (idx < 0 || t > S[idx].b) return null;
    const sp = S[idx];
    const tr = sp.trip;
    const p = tr.pattern;
    const n = p.stations.length;
    const o = v.st;
    o.trip = tr;
    o.t = t;
    o.u = 0;
    o.speed = 0;
    if (sp.kind === 'standby') {
      o.mode = 'standby';
      o.k = 0;
      o.dist = p.dist[0];
      o.nextT = tr.start;
      return o;
    }
    if (sp.kind === 'arrived') {
      o.mode = 'arrived';
      o.k = n - 1;
      o.dist = p.dist[n - 1];
      o.nextT = sp.b;
      return o;
    }
    const T = tr.t;
    const rel = t - tr.start;
    let k = sp.hint;
    while (k < n - 1 && T[2 * (k + 1)] <= rel) k++;
    while (k > 0 && T[2 * k] > rel) k--;
    sp.hint = k;
    if (k >= n - 1) {
      o.mode = 'arrived';
      o.k = n - 1;
      o.dist = p.dist[n - 1];
      o.nextT = tr.end;
      return o;
    }
    const dep = T[2 * k + 1];
    o.k = k;
    if (rel < dep) {
      o.mode = 'stop';
      o.dist = p.dist[k];
      o.nextT = tr.start + dep;
      return o;
    }
    const arr = T[2 * (k + 1)];
    const dur = arr - dep;
    const u = dur > 0 ? (rel - dep) / dur : 1;
    const d0 = p.dist[k];
    const d1 = p.dist[k + 1];
    o.mode = 'run';
    o.u = u;
    o.dist = d0 + (d1 - d0) * prof(u);
    o.speed = dur > 0 ? ((d1 - d0) / dur) * profSpeed(u) : 0;
    o.nextT = tr.start + arr;
    return o;
  }

  /** the plans that can have trains at this instant: today's, and yesterday's after-midnight runs */
  plansAt(ms: number): DayPlan[] {
    const today = this.zone.wall(ms).key;
    return [this.plan(addDays(today, -1)), this.plan(today)];
  }

  /** every visible train at instant `ms` (the state objects are reused between calls) */
  states(ms: number, out: TrainState[]): TrainState[] {
    out.length = 0;
    for (const plan of this.plansAt(ms)) {
      const t = (ms - plan.base) / 1000;
      if (t < plan.firstDep - PRE_SHOW - 60 || t > plan.lastArr + ARR_DWELL + 60) continue;
      for (const v of plan.vehicles) {
        const st = this.stateAt(v, t);
        if (st) out.push(st);
      }
    }
    return out;
  }

  findVehicle(key: string): Vehicle | undefined {
    const day = key.slice(0, 8);
    return (this.cachedPlan(day) ?? this.plan(day)).byKey.get(key);
  }

  /** upcoming departures from a station (and same-named neighbours), grouped by line and destination */
  departures(stations: number[], ms: number, per = 3): DepartureGroup[] {
    const today = this.zone.wall(ms).key;
    const groups = new Map<string, DepartureGroup>();
    for (const key of [addDays(today, -1), today, addDays(today, 1)]) {
      const plan = this.plan(key);
      const t = (ms - plan.base) / 1000;
      if (t > plan.lastArr + 60) continue;
      for (const idx of stations) {
        for (const e of plan.events.get(idx) ?? []) {
          const p = e.trip.pattern;
          if (e.k === p.stations.length - 1 || e.dep < t - 10) continue;
          const gk = `${p.line.id}|${p.headsign}`;
          let g = groups.get(gk);
          if (!g) groups.set(gk, (g = { line: p.line, headsign: p.headsign, items: [] }));
          g.items.push({ ms: plan.base + e.dep * 1000, trip: e.trip, vehicle: e.trip.vehicle });
        }
      }
    }
    const out = [...groups.values()];
    for (const g of out) {
      g.items.sort((a, b) => a.ms - b.ms);
      g.items.length = Math.min(g.items.length, per);
    }
    return out.sort((a, b) => a.line.order - b.line.order || (a.items[0]?.ms ?? 0) - (b.items[0]?.ms ?? 0));
  }

  /** the next first departure of the day after `ms` (for the "no trains right now" notice) */
  nextService(ms: number): number | null {
    const today = this.zone.wall(ms).key;
    for (const key of [today, addDays(today, 1)]) {
      const plan = this.plan(key);
      if (!plan.trips.length) continue;
      const at = plan.base + plan.firstDep * 1000;
      if (at > ms) return at;
    }
    return null;
  }
}
