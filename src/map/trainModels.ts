import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Float32BufferAttribute,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StockFamily } from '../config';

/**
 * Edmonton's light rail vehicles, modelled after photos of the real fleet:
 *
 *  - Siemens-Duewag U2 (Capital & Metro, 1978–): boxy, flat front, white with the ETS blue band and a grey
 *    stripe under it, rows of small windows. Two-section articulated cars with a cab at each end.
 *  - Siemens SD160 (Capital & Metro, 2008–): same livery, raked rounded front, big dark windows.
 *  - Bombardier/Alstom Flexity Freedom (Valley Line, 2023–): low floor, seven modules, blue lower body,
 *    white upper body, continuous dark glazing and a large curved windscreen.
 *
 * Every section is built in its own frame (x forward, y up, z to the right). The sides are painted with
 * canvas textures; all parts are instanced so the whole fleet draws in a couple of dozen calls.
 */

export type ModelKey = 'u2' | 'sd160' | 'flexity';
export type Role = 'cabF' | 'cabR' | 'midA' | 'midB';

export interface ModelSpec {
  key: ModelKey;
  name: string;
  /** section length, articulation gap and gap between coupled cars (m) */
  secLen: number;
  art: number;
  coupler: number;
  w: number;
  /** body height above the underframe */
  h: number;
  /** floor / underframe height */
  bottom: number;
  /** how far the windscreen leans back */
  nose: number;
}

export const MODELS: Record<ModelKey, ModelSpec> = {
  u2: { key: 'u2', name: 'Siemens-Duewag U2', secLen: 11.9, art: 0.5, coupler: 1.1, w: 2.65, h: 2.85, bottom: 0.95, nose: 0.45 },
  sd160: { key: 'sd160', name: 'Siemens SD160', secLen: 12.1, art: 0.5, coupler: 1.1, w: 2.65, h: 2.85, bottom: 0.95, nose: 1.55 },
  flexity: { key: 'flexity', name: 'Bombardier Flexity Freedom', secLen: 5.8, art: 0.2, coupler: 1.1, w: 2.65, h: 3.05, bottom: 0.35, nose: 1.3 },
};

export interface SectionSpec {
  /** distance from the nose of the train to the centre of this section */
  off: number;
  len: number;
  role: Role;
  panto: boolean;
}
export interface Consist {
  model: ModelSpec;
  sections: SectionSpec[];
  length: number;
  label: string;
}

/** cars per train on the high-floor lines (an approximation of normal service) */
const CARS: Record<string, number> = { capital: 4, metro: 3 };
const consists = new Map<string, Consist>();

function buildConsist(model: ModelKey, cars: number): Consist {
  const m = MODELS[model];
  const sections: SectionSpec[] = [];
  let x = 0;
  if (model === 'flexity') {
    for (let i = 0; i < 7; i++) {
      sections.push({ off: x + m.secLen / 2, len: m.secLen, role: i === 0 ? 'cabF' : i === 6 ? 'cabR' : i % 2 ? 'midA' : 'midB', panto: i === 3 });
      x += m.secLen + (i < 6 ? m.art : 0);
    }
  } else {
    // each car is two sections with a driving cab at both ends, so coupled cars meet nose to nose
    for (let c = 0; c < cars; c++) {
      sections.push({ off: x + m.secLen / 2, len: m.secLen, role: 'cabF', panto: true });
      x += m.secLen + m.art;
      sections.push({ off: x + m.secLen / 2, len: m.secLen, role: 'cabR', panto: false });
      x += m.secLen + (c < cars - 1 ? m.coupler : 0);
    }
  }
  const label = model === 'flexity' ? `${m.name}, 7 modules (low floor)` : `${m.name} × ${cars} cars (high floor)`;
  return { model: m, sections, length: x, label };
}

/** which train a vehicle is drawn as: U2 or SD160 (stable per train) on Capital/Metro, Flexity on the Valley Line */
export function consistFor(family: StockFamily, lineId: string, vehicleId: string): Consist {
  let model: ModelKey = 'flexity';
  let cars = 1;
  if (family === 'highfloor') {
    let h = 0;
    for (let i = 0; i < vehicleId.length; i++) h = (h * 31 + vehicleId.charCodeAt(i)) >>> 0;
    model = h % 5 < 2 ? 'u2' : 'sd160'; // about 37 U2s to 57 SD160s
    cars = CARS[lineId] ?? 4;
  }
  const key = `${model}:${cars}`;
  let c = consists.get(key);
  if (!c) consists.set(key, (c = buildConsist(model, cars)));
  return c;
}

/* ------------------------------------------------------------------ side paintings */

const ETS_BLUE = '#2343a6';
const ETS_GREY = '#8a919a';
const FLEX_BLUE = '#1f3c9c';
const WHITE = '#eef0ee';
const GLASS = '#1a2230';

interface Painted {
  map: CanvasTexture;
  glow: CanvasTexture;
}

/**
 * Paints one side of a section. u runs along the section (0 = rear, 1 = front), v up the body (0 = floor).
 * `glow` receives only the windows, used as the emissive map so they light up at night.
 */
function paint(model: ModelKey, role: Role): Painted {
  const W = 512;
  const H = 128;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const cv = mk();
  const gl = mk();
  const g = cv.getContext('2d')!;
  const e = gl.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  // helpers in (u, v) units
  const X = (u: number) => u * W;
  const Y = (v: number) => (1 - v) * H;
  const rect = (ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(X(u0), Y(v1), X(u1) - X(u0), Y(v0) - Y(v1));
  };
  const win = (u0: number, v0: number, u1: number, v1: number) => {
    rect(g, u0, v0, u1, v1, GLASS);
    rect(e, u0 + 0.004, v0 + 0.02, u1 - 0.004, v1 - 0.02, '#fff');
  };
  const isCab = role === 'cabF' || role === 'cabR';

  if (model === 'flexity') {
    rect(g, 0, 0, 1, 1, WHITE);
    // blue lower body, sweeping up towards the cab front
    g.fillStyle = FLEX_BLUE;
    g.beginPath();
    g.moveTo(X(0), Y(0));
    g.lineTo(X(0), Y(0.4));
    if (isCab) {
      g.lineTo(X(0.62), Y(0.4));
      g.bezierCurveTo(X(0.8), Y(0.4), X(0.86), Y(0.5), X(0.93), Y(0.62));
      g.lineTo(X(1), Y(0.62));
    } else g.lineTo(X(1), Y(0.4));
    g.lineTo(X(1), Y(0));
    g.closePath();
    g.fill();
    // continuous glazing with thin mullions
    const top = 0.88;
    const end = isCab ? 0.66 : 1;
    win(0.01, 0.45, end - 0.01, top);
    g.fillStyle = '#3a4352';
    for (let u = 0.2; u < end - 0.05; u += 0.2) g.fillRect(X(u) - 2, Y(top), 4, Y(0.45) - Y(top));
    if (isCab) win(0.7, 0.48, 0.9, top); // driver's side window
    if (role === 'midA') {
      // a double glass door in the middle of the module
      rect(g, 0.33, 0.04, 0.67, 0.9, '#d9dde3');
      win(0.35, 0.06, 0.49, 0.88);
      win(0.51, 0.06, 0.65, 0.88);
    }
    if (isCab) {
      rect(g, 0.18, 0.04, 0.42, 0.9, '#d9dde3');
      win(0.2, 0.06, 0.29, 0.88);
      win(0.31, 0.06, 0.4, 0.88);
    }
    // roof line
    rect(g, 0, 0.95, 1, 1, '#d6dadf');
  } else {
    rect(g, 0, 0, 1, 1, WHITE);
    // the ETS stripes: grey under blue, at window-sill height
    rect(g, 0, 0.3, 1, 0.36, ETS_GREY);
    rect(g, 0, 0.36, 1, 0.47, ETS_BLUE);
    const doors = isCab ? [0.16, 0.56] : [0.24, 0.66];
    const dw = 0.13;
    const end = isCab ? 0.84 : 1;
    // windows between the doors
    const spans: [number, number][] = [];
    let a = 0.02;
    for (const d of doors) {
      spans.push([a, d - 0.015]);
      a = d + dw + 0.015;
    }
    spans.push([a, end - 0.02]);
    const pane = model === 'u2' ? 0.075 : 0.13;
    for (const [s0, s1] of spans) {
      const n = Math.max(1, Math.round((s1 - s0) / pane));
      const step = (s1 - s0) / n;
      for (let i = 0; i < n; i++) {
        const u0 = s0 + i * step + 0.006;
        const u1 = s0 + (i + 1) * step - 0.006;
        if (model === 'u2') win(u0, 0.54, u1, 0.8);
        else win(u0, 0.52, u1, 0.86);
      }
    }
    // doors: outlines with two tall windows
    for (const d of doors) {
      g.strokeStyle = '#9aa1aa';
      g.lineWidth = 2;
      g.strokeRect(X(d), Y(0.88), X(d + dw) - X(d), Y(0.02) - Y(0.88));
      g.beginPath();
      g.moveTo(X(d + dw / 2), Y(0.88));
      g.lineTo(X(d + dw / 2), Y(0.02));
      g.stroke();
      win(d + 0.012, 0.52, d + dw / 2 - 0.008, 0.84);
      win(d + dw / 2 + 0.008, 0.52, d + dw - 0.012, 0.84);
    }
    if (isCab) win(0.87, model === 'u2' ? 0.54 : 0.5, 0.97, model === 'u2' ? 0.82 : 0.88); // cab side window
    rect(g, 0, 0.96, 1, 1, '#d3d7dc');
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(cv), glow: tex(gl) };
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.28, 'rgba(0,0,0,1)');
  g.addColorStop(0.72, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 32);
  return new CanvasTexture(c);
}

/* ------------------------------------------------------------------ geometry */

/**
 * A car section as a loft: a rounded cross-section (curved roof edges, sides leaning in a little above the
 * windows) swept along the length. For a cab the cross-section follows the nose: the roof drops along the
 * windscreen curve and the corners round off in plan, so the front is curved in every direction.
 * UVs are u = along the section, v = height / body height, so the side paintings line up on every surface.
 * Vertex colours darken the windscreen on cabs.
 */
function loftGeometry(m: ModelSpec, cab: boolean): BufferGeometry {
  const L = m.secLen;
  const H = m.h;
  const W = m.w / 2;
  const n = m.nose;
  const r = m.key === 'flexity' ? 0.62 : 0.5; // roof edge radius
  const rc = m.key === 'flexity' ? 0.95 : m.key === 'sd160' ? 0.7 : 0.4; // corner radius of the front in plan
  const winLow = (m.key === 'flexity' ? 0.44 : 0.47) * H;
  const tumble = 0.05;
  const ARC = 6;
  const tipX = L / 2 + 0.05;

  // nose profile: quadratic curve from (tip, 0.42H) via (tip - 0.1, cH) to (tip - n, H)
  const cH = (n > 1 ? 0.88 : 0.97) * H;
  const nose: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = (1 - t) * (1 - t) * tipX + 2 * (1 - t) * t * (tipX - 0.1) + t * t * (tipX - n);
    const y = (1 - t) * (1 - t) * 0.42 * H + 2 * (1 - t) * t * cH + t * t * H;
    nose.push([x, y]);
  }
  const topAt = (x: number) => {
    if (!cab || x <= tipX - n) return H;
    for (let i = 1; i < nose.length; i++) {
      const [x0, y0] = nose[i - 1];
      const [x1, y1] = nose[i];
      if (x <= x0 && x >= x1) return y0 + ((y1 - y0) * (x0 - x)) / (x0 - x1 || 1);
    }
    return 0.42 * H;
  };
  const halfAt = (x: number) => {
    if (!cab || x <= tipX - rc) return W;
    const d = Math.min(rc, x - (tipX - rc));
    return W - rc + Math.sqrt(Math.max(0, rc * rc - d * d));
  };

  // slices along the length; dense through the nose, with a pair at the windscreen edge for a crisp colour change
  const xs: number[] = [-L / 2];
  if (cab) {
    const start = tipX - Math.max(n, rc) - 0.02;
    xs.push(start);
    const steps = 22;
    for (let i = 1; i <= steps; i++) xs.push(start + ((tipX - start) * i) / steps);
    xs.push(tipX - n - 0.004, tipX - n);
    xs.sort((p, q) => p - q);
  } else xs.push(L / 2);

  // one cross-section: (z, y) points from the bottom of the left side, over the roof, down to the bottom right
  const section = (x: number) => {
    const top = topAt(x);
    const hw = halfAt(x);
    const re = Math.min(r, hw * 0.8, Math.max(0.02, (top - 0.05) / 2));
    const side = (y: number) => hw * (1 - tumble * Math.min(1, Math.max(0, (y - 0.5 * H) / (0.5 * H))));
    const ys = [0, winLow - 0.004, winLow, top - re].map((y) => Math.min(y, top - re));
    const pts: [number, number][] = [];
    for (const y of ys) pts.push([-side(y), y]);
    const zc = side(top - re) - re;
    for (let k = 1; k <= ARC; k++) {
      const a = Math.PI - (k / ARC) * (Math.PI / 2);
      pts.push([-zc + re * Math.cos(a) - 0, top - re + re * Math.sin(a)]);
    }
    for (let k = 0; k < ARC; k++) {
      const a = Math.PI / 2 - (k / ARC) * (Math.PI / 2);
      pts.push([zc + re * Math.cos(a), top - re + re * Math.sin(a)]);
    }
    for (const y of [...ys].reverse()) pts.push([side(y), y]);
    return pts;
  };

  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const glass = new Color(GLASS);
  const push = (x: number, z: number, y: number) => {
    pos.push(x, y, z);
    uv.push(Math.min(1, Math.max(0, (x + L / 2) / L)), Math.min(1, y / H));
    const dark = cab && x >= tipX - n - 0.001 && y >= winLow - 0.001;
    if (dark) col.push(glass.r * 1.6, glass.g * 1.6, glass.b * 1.6);
    else col.push(1, 1, 1);
  };
  const rings = xs.map((x) => section(x));
  const P = rings[0].length;
  rings.forEach((ring, i) => ring.forEach(([z, y]) => push(xs[i], z, y)));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k;
      const b = (i + 1) * P + k;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const body = new BufferGeometry();
  body.setAttribute('position', new Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  body.setAttribute('color', new Float32BufferAttribute(col, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  // make sure the surface faces outwards (the roof must point up)
  const nrm = body.getAttribute('normal');
  const topIdx = P >> 1;
  if (nrm.getY(topIdx) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    body.setIndex(idx);
    body.computeVertexNormals();
  }

  // flat end caps
  const cap = (ring: [number, number][], x: number, dir: 1 | -1) => {
    const g = new BufferGeometry();
    const cp: number[] = [];
    const cu: number[] = [];
    const cc: number[] = [];
    const cn: number[] = [];
    const ci: number[] = [];
    const add = (z: number, y: number) => {
      cp.push(x, y, z);
      cu.push(Math.min(1, Math.max(0, (x + L / 2) / L)), Math.min(1, y / H));
      cc.push(1, 1, 1);
      cn.push(dir, 0, 0);
    };
    add(0, ring.reduce((s2, p2) => s2 + p2[1], 0) / ring.length);
    ring.forEach(([z, y]) => add(z, y));
    for (let k = 1; k < ring.length; k++) ci.push(0, k, k + 1 > ring.length ? 1 : k + 1);
    ci.push(0, ring.length, 1);
    // winding from the ring's signed area: x part of Σ (p_k × p_k+1) with points (x, y, z)
    let area = 0;
    for (let k = 0; k < ring.length; k++) {
      const [z0, y0] = ring[k];
      const [z1, y1] = ring[(k + 1) % ring.length];
      area += y0 * z1 - z0 * y1;
    }
    if (Math.sign(area) !== dir) for (let i = 0; i < ci.length; i += 3) [ci[i + 1], ci[i + 2]] = [ci[i + 2], ci[i + 1]];
    g.setAttribute('position', new Float32BufferAttribute(cp, 3));
    g.setAttribute('uv', new Float32BufferAttribute(cu, 2));
    g.setAttribute('color', new Float32BufferAttribute(cc, 3));
    g.setAttribute('normal', new Float32BufferAttribute(cn, 3));
    g.setIndex(ci);
    return g;
  };
  return mergeGeometries([body, cap(rings[0], xs[0], -1), cap(rings[rings.length - 1], xs[xs.length - 1], 1)])!;
}

/** a lowered pantograph: base frame with the folded arms on top */
function pantoGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const base = new BoxGeometry(1.5, 0.14, 1.2);
  base.translate(0, 0.07, 0);
  parts.push(base);
  for (const z of [-0.45, 0.45]) {
    const arm = new BoxGeometry(2.0, 0.07, 0.07);
    arm.rotateZ(0.22);
    arm.translate(0.1, 0.35, z);
    parts.push(arm);
  }
  const head = new BoxGeometry(0.12, 0.08, 1.7);
  head.translate(1.05, 0.58, 0);
  parts.push(head);
  return mergeGeometries(parts)!;
}

export type PartName =
  | 'blob'
  | 'under'
  | 'cabBody'
  | 'midA'
  | 'midB'
  | 'roof'
  | 'equip'
  | 'panto'
  | 'ghost';
export const PARTS: PartName[] = ['blob', 'under', 'cabBody', 'midA', 'midB', 'roof', 'equip', 'panto', 'ghost'];
/** parts coloured per instance (roof: real colour blended with the line colour when zoomed out; ghost: line colour) */
export const TINTED = new Set<PartName>(['roof', 'ghost']);

export interface Fleet {
  m: ModelSpec;
  parts: Record<PartName, InstancedMesh>;
  local: Record<string, Matrix4>;
}

export interface FleetMaterials {
  shell: MeshLambertMaterial;
  glass: MeshLambertMaterial;
  under: MeshLambertMaterial;
  roof: MeshLambertMaterial;
  equip: MeshLambertMaterial;
  panto: MeshLambertMaterial;
  blob: MeshBasicMaterial;
  ghost: MeshBasicMaterial;
  /** textured sides, per model and role (lit windows at night use emissive) */
  sides: MeshLambertMaterial[];
}

export function makeMaterials(): FleetMaterials {
  return {
    shell: new MeshLambertMaterial({ color: WHITE }),
    glass: new MeshLambertMaterial({ color: GLASS, emissive: new Color('#ffd9a0'), emissiveIntensity: 0 }),
    under: new MeshLambertMaterial({ color: '#2b3038' }),
    roof: new MeshLambertMaterial({ color: '#ffffff' }),
    equip: new MeshLambertMaterial({ color: '#b8bec6' }),
    panto: new MeshLambertMaterial({ color: '#3a3f47' }),
    blob: new MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, opacity: 0.42, depthWrite: false }),
    ghost: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
    sides: [],
  };
}

function sideMaterial(mats: FleetMaterials, p: Painted, repeatU = 1, repeatV = 1, offU = 0): MeshLambertMaterial {
  for (const t of [p.map, p.glow]) {
    t.repeat.set(repeatU, repeatV);
    t.offset.set(offU, 0);
  }
  const mat = new MeshLambertMaterial({ map: p.map, emissive: new Color('#ffd9a0'), emissiveMap: p.glow, emissiveIntensity: 0 });
  mats.sides.push(mat);
  return mat;
}

const MAX_BODIES = 900;

export function makeFleet(key: ModelKey, mats: FleetMaterials): Fleet {
  const m = MODELS[key];
  const L = m.secLen;
  const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);

  // rounded sections; the cab shares the side painting style but has its own (cab window, no middle door)
  const cab = loftGeometry(m, true);
  const cabSide = sideMaterial(mats, paint(key, 'cabF'));
  cabSide.vertexColors = true; // dark windscreen
  const mid = loftGeometry(m, false);
  const midA = sideMaterial(mats, paint(key, 'midA'));
  const midB = sideMaterial(mats, paint(key, 'midB'));

  const blob = new PlaneGeometry(L + m.art + 0.6, m.w * 2.1);
  blob.rotateX(-Math.PI / 2);
  const geo: Record<PartName, BufferGeometry> = {
    blob,
    under: box(L * 0.8, m.bottom, m.w * 0.84),
    cabBody: cab,
    midA: mid,
    midB: mid,
    roof: box(L * 0.9, 0.1, m.w * 0.56),
    equip: box(2.4, 0.38, m.w * 0.55),
    panto: pantoGeometry(),
    ghost: box(L + m.art, (m.h + m.bottom) * 1.05, m.w * 1.45),
  };
  const mat: Record<PartName, Material | Material[]> = {
    blob: mats.blob,
    under: mats.under,
    cabBody: cabSide,
    midA,
    midB,
    roof: mats.roof,
    equip: mats.equip,
    panto: mats.panto,
    ghost: mats.ghost,
  };
  if (key !== 'flexity') {
    // the U2 and SD160 have no separate middle sections
    geo.midA = geo.midB = box(0.01, 0.01, 0.01);
  }
  const white = new Color('#ffffff');
  const parts = {} as Record<PartName, InstancedMesh>;
  for (const name of PARTS) {
    const im = new InstancedMesh(geo[name], mat[name], MAX_BODIES);
    im.frustumCulled = false;
    im.count = 0;
    if (TINTED.has(name)) im.setColorAt(0, white); // create the colour buffer up front (no shader rebuild later)
    im.renderOrder = name === 'ghost' ? 10 : name === 'blob' ? 1 : 2;
    parts[name] = im;
  }
  const T = (x: number, y: number, z: number, rotY = 0) => new Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  const b = m.bottom;
  const roofY = b + m.h + 0.02;
  const local = {
    cabF: T(0, b, 0),
    cabR: T(0, b, 0, Math.PI),
    mid: T(0, b, 0),
    roofMid: T(0, roofY, 0),
    // cab roofs are shorter: the windscreen takes the front of the roof
    roofF: T(-m.nose / 2 - 0.1, roofY, 0).multiply(new Matrix4().makeScale((L - m.nose - 0.3) / (L * 0.9), 1, 1)),
    roofR: T(m.nose / 2 + 0.1, roofY, 0).multiply(new Matrix4().makeScale((L - m.nose - 0.3) / (L * 0.9), 1, 1)),
    equip: T(L * 0.12, roofY + 0.2, 0),
    panto: T(-L * 0.2, roofY + 0.06, 0),
    under: T(0, b / 2, 0),
    ghost: T(0, (b + m.h) * 0.5, 0),
    blob: T(0, 0.04, 0),
  };
  return { m, parts, local };
}

export const MAX_FLEET_BODIES = MAX_BODIES;
