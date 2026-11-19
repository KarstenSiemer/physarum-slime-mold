// Pictures of the state of the prototype: a part of the grid at a zoom, smooth between the cells. Prototype code: the
// colours show the model's fields, not the look of the app.
import { writePng } from '../flow/prototype/world';
import type { Sim } from './sim';

export interface View {
  /** The part of the grid: the cell of its top left corner and its size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixels per cell. */
  zoom: number;
}

/** A field read between the cells, bilinear (the centre of a cell is at its index + 0.5). */
function sample(f: (c: number) => number, w: number, h: number, x: number, y: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const [tx, ty] = [fx - x0, fy - y0];
  const a = f(y0 * w + x0) * (1 - tx) + f(y0 * w + x1) * tx;
  const b = f(y1 * w + x0) * (1 - tx) + f(y1 * w + x1) * tx;
  return a * (1 - ty) + b * ty;
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Three panels side by side. Left: the plasm (the trail, yellow) on the ground, with the slime as a pale film and walls
 * grey. Middle: the flow memory D of the tube cells, from dark blue (0) over red to white (1): the veins of the model.
 * Right: the flux through each cell, on a log scale, from 0.01 (dark) to 10 (white).
 */
export function picture(sim: Sim, view: View, path: string) {
  const { w, h } = sim;
  const { zoom } = view;
  const W = view.w * zoom;
  const H = view.h * zoom;
  const panels = 3;
  const rgb = new Uint8Array(W * panels * H * 3);
  const { open } = sim.layout;
  const full = 20;
  const trail = (c: number) => (open[c] ? sim.trail[c]! : 0);
  const slime = (c: number) => (open[c] && sim.hasSlime(c) ? 1 : 0);
  const wall = (c: number) => (open[c] ? 0 : 1);
  const tube = (c: number) => (sim.B[c]! >= 0.05 ? 1 : 0);
  const memory = (c: number) => (sim.B[c]! >= 0.05 ? sim.D[c]! : 0);
  const flux = (c: number) => (open[c] ? Math.log10(Math.max(sim.Q[c]!, 1e-3)) : -3);
  const food = (c: number) => sim.layout.food[c]!;
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const gx = view.x + (px + 0.5) / zoom;
      const gy = view.y + (py + 0.5) / zoom;
      const t = sample(trail, w, h, gx, gy);
      const s = sample(slime, w, h, gx, gy);
      const wl = sample(wall, w, h, gx, gy);
      const fd = sample(food, w, h, gx, gy);
      // Plasm.
      const a = smooth(0.8, full, t);
      const ground = [18 + 40 * s + 25 * fd, 18 + 38 * s + 12 * fd, 22 + 30 * s];
      const plasm = [255, 200 + 40 * a, 40 + 60 * a];
      const edge = smooth(0.6, 1.4, t);
      let o = (py * W * panels + px) * 3;
      for (let k = 0; k < 3; k++) {
        const g = ground[k]! * (1 - wl) + 90 * wl;
        rgb[o + k] = Math.round(g * (1 - edge * (0.35 + 0.65 * a)) + plasm[k]! * edge * (0.35 + 0.65 * a));
      }
      // The flow memory of the tubes.
      const tb = sample(tube, w, h, gx, gy);
      const d = sample(memory, w, h, gx, gy) / Math.max(tb, 1e-6);
      const on = smooth(0.3, 0.6, tb);
      const col =
        d < 0.5 ? [40 + 400 * d, 30 + 80 * d, 120 - 100 * d] : [240, 70 + 370 * (d - 0.5), 70 + 370 * (d - 0.5)];
      o += W * 3;
      for (let k = 0; k < 3; k++) {
        const g = 14 * (1 - wl) + 90 * wl;
        rgb[o + k] = Math.round(g * (1 - on) + Math.min(255, col[k]!) * on);
      }
      // The flux.
      const q = (sample(flux, w, h, gx, gy) + 2) / 3;
      const v = Math.min(1, Math.max(0, q));
      o += W * 3;
      const fcol = [255 * Math.min(1, 2 * v), 255 * Math.max(0, 2 * v - 1) + 60 * v, 80 * v];
      for (let k = 0; k < 3; k++) {
        const g = 10 * (1 - wl) + 90 * wl;
        rgb[o + k] = Math.round(g * (1 - v) + fcol[k]! * v);
      }
    }
  writePng(path, W * panels, H, rgb);
}

/**
 * A lit picture of the model's plasm and veins: the plasm is the trail (a translucent yellow sheet), a vein is the
 * strength B · D of the tube cells (deeper and brighter), and the height of both is shaded with one light, smooth
 * between the cells. Prototype code: it shows the model's structure, not the look of the app.
 */
export function look(sim: Sim, view: View, path: string) {
  const { w, h } = sim;
  const { open } = sim.layout;
  const full = 25;
  const plasm = (c: number) => (open[c] ? Math.min(1, sim.trail[c]! / full) : 0);
  const vein = (c: number) => (open[c] && sim.B[c]! >= 0.05 ? Math.min(1, sim.B[c]! * sim.D[c]!) : 0);
  const slime = (c: number) => (open[c] && sim.hasSlime(c) ? 1 : 0);
  const wall = (c: number) => (open[c] ? 0 : 1);
  const { zoom } = view;
  const W = view.w * zoom;
  const H = view.h * zoom;
  const rgb = new Uint8Array(W * H * 3);
  const height = (gx: number, gy: number) =>
    0.5 * smooth(0.04, 0.6, sample(plasm, w, h, gx, gy)) + 0.9 * Math.sqrt(sample(vein, w, h, gx, gy));
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const gx = view.x + (px + 0.5) / zoom;
      const gy = view.y + (py + 0.5) / zoom;
      const t = sample(plasm, w, h, gx, gy);
      const v = Math.sqrt(sample(vein, w, h, gx, gy));
      const e = 0.35;
      const nx = (height(gx - e, gy) - height(gx + e, gy)) * 2.2;
      const ny = (height(gx, gy - e) - height(gx, gy + e)) * 2.2;
      const len = Math.hypot(nx, ny, 1);
      const [lx, ly, lz] = [-0.5, -0.6, 0.62];
      const diffuse = Math.max(0, (nx * lx + ny * ly + lz) / len);
      const hx = lx;
      const hy = ly;
      const hz = lz + 1;
      const hl = Math.hypot(hx, hy, hz);
      const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + hz) / (len * hl)), 30);
      const s = sample(slime, w, h, gx, gy);
      const wl = sample(wall, w, h, gx, gy);
      const a = smooth(0.03, 0.12, t);
      const ground = [28 + 26 * s, 27 + 24 * s, 30 + 16 * s];
      // The sheet: pale yellow; a vein: deeper orange.
      const body = [235 - 25 * v, 200 - 85 * v, 90 - 60 * v];
      const o = (py * W + px) * 3;
      for (let k = 0; k < 3; k++) {
        const g = ground[k]! * (1 - wl) + 72 * wl;
        const lit = body[k]! * (0.3 + 0.8 * diffuse) + 255 * spec * (0.25 + 0.5 * v) * a;
        rgb[o + k] = Math.round(
          Math.min(255, g * (1 - a * (0.55 + 0.45 * Math.max(t, v))) + lit * a * (0.55 + 0.45 * Math.max(t, v))),
        );
      }
    }
  writePng(path, W, H, rgb);
}
