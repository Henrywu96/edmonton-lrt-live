import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
} from 'three';
import type { StockKey } from '../config';

/**
 * Toy trains. Each car body is built in its own frame: x forward, y up, z to the right.
 * All parts are instanced, so the whole fleet draws in a handful of calls.
 * Sizes are in metres and a little chunkier than the real cars so they read from above.
 */
export interface StockSpec {
  bodies: number;
  len: number;
  gap: number;
  w: number;
  h: number;
  bottom: number;
  nose: number;
  label: string;
}

export const STOCK: Record<StockKey, StockSpec> = {
  u2: { bodies: 4, len: 12.1, gap: 0.55, w: 3.4, h: 4.2, bottom: 1.2, nose: 1.9, label: 'Siemens high-floor LRVs' },
  flexity: { bodies: 5, len: 8.3, gap: 0.3, w: 3.4, h: 3.9, bottom: 0.42, nose: 2.3, label: 'Bombardier Flexity Freedom low-floor LRV' },
};
export const trainLength = (sp: StockSpec) => sp.bodies * sp.len + (sp.bodies - 1) * sp.gap;

function cabGeometry(sp: StockSpec): BufferGeometry {
  const L = sp.len;
  const H = sp.h;
  const n = sp.nose;
  const s = new Shape();
  s.moveTo(-L / 2, 0);
  s.lineTo(L / 2 - 0.5, 0);
  s.quadraticCurveTo(L / 2 + 0.05, 0, L / 2 + 0.05, 0.55);
  s.lineTo(L / 2 + 0.05, H * 0.42);
  s.quadraticCurveTo(L / 2 - 0.05, H * 0.9, L / 2 - n, H);
  s.lineTo(-L / 2, H);
  s.lineTo(-L / 2, 0);
  const depth = sp.w - 0.24;
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
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

export type PartName = 'cab' | 'mid' | 'glass' | 'side' | 'roof' | 'under' | 'blob' | 'ghost';
export const PARTS: PartName[] = ['blob', 'under', 'cab', 'mid', 'glass', 'side', 'roof', 'ghost'];
/** parts tinted per train (line colour) */
const TINTED = new Set<PartName>(['side', 'roof', 'ghost']);

export interface Fleet {
  sp: StockSpec;
  parts: Record<PartName, InstancedMesh>;
  local: Record<string, Matrix4>;
}

export interface FleetMaterials {
  shell: MeshLambertMaterial;
  glass: MeshLambertMaterial;
  paint: MeshLambertMaterial;
  under: MeshLambertMaterial;
  blob: MeshBasicMaterial;
  ghost: MeshBasicMaterial;
}

export function makeMaterials(): FleetMaterials {
  return {
    shell: new MeshLambertMaterial({ color: '#eef0f0' }),
    glass: new MeshLambertMaterial({ color: '#1d2a38', emissive: new Color('#ffd9a0'), emissiveIntensity: 0 }),
    paint: new MeshLambertMaterial({ color: '#ffffff' }),
    under: new MeshLambertMaterial({ color: '#2b3038' }),
    blob: new MeshBasicMaterial({ map: shadowTexture(), color: '#000000', transparent: true, opacity: 0.42, depthWrite: false }),
    ghost: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
  };
}

const MAX_BODIES = 600;

export function makeFleet(key: StockKey, mats: FleetMaterials): Fleet {
  const sp = STOCK[key];
  const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);
  const mid = box(sp.len, sp.h, sp.w);
  mid.translate(0, sp.h / 2, 0);
  const blob = new PlaneGeometry(sp.len + sp.gap + 0.6, sp.w * 2.1);
  blob.rotateX(-Math.PI / 2);
  const geo: Record<PartName, BufferGeometry> = {
    cab: cabGeometry(sp),
    mid,
    glass: box(sp.len * 0.7, 1.0, sp.w + 0.04),
    side: box(sp.len - 0.4, 0.5, sp.w + 0.06),
    roof: box(sp.len * 0.9, 0.18, sp.w * 0.84),
    under: box(sp.len * 0.78, sp.bottom, sp.w * 0.8),
    blob,
    ghost: box(sp.len + sp.gap, sp.h * 1.1, sp.w * 1.45),
  };
  const mat: Record<PartName, Material> = {
    cab: mats.shell,
    mid: mats.shell,
    glass: mats.glass,
    side: mats.paint,
    roof: mats.paint,
    under: mats.under,
    blob: mats.blob,
    ghost: mats.ghost,
  };
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
  const gy = sp.bottom + sp.h * 0.58;
  const local = {
    cabF: T(0, sp.bottom, 0),
    cabR: T(0, sp.bottom, 0, Math.PI),
    mid: T(0, sp.bottom, 0),
    glassF: T(-sp.nose * 0.45, gy, 0),
    glassR: T(sp.nose * 0.45, gy, 0),
    glassM: T(0, gy, 0),
    side: T(0, sp.bottom + sp.h * 0.27, 0),
    roof: T(0, sp.bottom + sp.h + 0.08, 0),
    under: T(0, sp.bottom / 2, 0),
    ghost: T(0, sp.bottom + sp.h * 0.5, 0),
    blob: T(0, 0.06, 0),
  };
  return { sp, parts, local };
}

export const MAX_FLEET_BODIES = MAX_BODIES;
