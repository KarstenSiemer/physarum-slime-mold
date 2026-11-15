// The food sites of the flow (ADR 0029, decision 17) on the CPU: the sites of the scenes with the flow, and the time
// that the engine spends on the sites after a paint (src/engine/sites.ts SiteCells, Engine.syncSites()).
//
// - The sites of a scene: as the engine makes them on the scene's grid (on a canvas of 16:10 for a scene without a
//   lattice, as the runs of engine/ have it): the sites, their cells, and the entries of the list with the ends of the
//   blocks (sites.ts SITE_BLOCK).
// - The time: a drag across a grid of 1,536 × 960 cells (the default grid), a segment each half radius, beside 40
//   dabs, one call after each segment as the engine makes it during a drag; then one call with nothing new, as after a
//   paint of another kind, and one call without cells kept from before, as on a new grid.
//
// Usage: node --import ./research/flow/register.mjs research/flow/sites.ts
import { fromShape, strokeOn } from '../../src/engine/environment.ts';
import { flowSites, foodStrokes, SiteCells, type FoodStroke } from '../../src/engine/sites.ts';
import { gridSize } from '../../src/engine/sizing.ts';
import type { Stroke } from '../../src/engine/types.ts';
import { constrain } from '../../src/model/params.ts';
import { presetById } from '../../src/model/presets.ts';

for (const id of ['maze', 'tokyo', 'food-ring', 'rival-networks', 'tokyo-rivals']) {
  const preset = presetById(id)!;
  const settings = constrain(preset.settings());
  const [w, h] = settings.lattice ?? gridSize(settings.resolution, 1.6);
  const edits = (preset.env ?? []).map((e) => fromShape(e, settings.boundary));
  const strokes = foodStrokes(edits).map((s) => s.flatMap((e) => strokeOn(e, w, h) ?? []));
  const sites = flowSites(strokes, w, h, settings.boundary);
  const counts = sites.list.map((s) => s.count);
  console.log(
    JSON.stringify({
      scene: id,
      grid: [w, h],
      strokes: strokes.length,
      sites: sites.list.length,
      cells: counts.reduce((a, b) => a + b, 0),
      entries: sites.cells.length,
      cellsPerSite: [Math.min(...counts), Math.max(...counts)],
    }),
  );
}

const [w, h] = [1536, 960];
const time = (f: () => void, n: number) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) f();
  return (performance.now() - t0) / n;
};
for (const radius of [6, 30, 90]) {
  const step = radius / 2;
  const at = (k: number): [number, number] => [150 + k * step, 480 + 100 * Math.sin(k / 10)];
  const drag: Stroke[] = [{ kind: 'food', from: at(0), to: at(0), radius, boundary: 'wrap' }];
  for (let k = 1; k * step <= 1200; k++)
    drag.push({ kind: 'food', from: at(k - 1), to: at(k), radius, boundary: 'wrap' });
  const dabs: FoodStroke[] = Array.from({ length: 40 }, (_, i) => [
    { kind: 'food', from: [40 + i * 37, 100], to: [40 + i * 37, 100], radius: 8, boundary: 'wrap' },
  ]);
  const memo = new SiteCells();
  const each: number[] = [];
  for (let k = 1; k <= drag.length; k++) {
    const t0 = performance.now();
    memo.sites([...dabs, drag.slice(0, k)], w, h, 'wrap');
    each.push(performance.now() - t0);
  }
  const sites = memo.sites([...dabs, drag], w, h, 'wrap');
  const later = each.slice(1);
  console.log(
    JSON.stringify({
      radius,
      segments: drag.length,
      dragCells: sites.list[40]?.count,
      allCells: sites.list.reduce((a, s) => a + s.count, 0),
      msPerSegment: +(later.reduce((a, b) => a + b, 0) / later.length).toFixed(2),
      msLastSegment: +(each[each.length - 1] ?? 0).toFixed(2),
      msFirstCall: +(each[0] ?? 0).toFixed(2),
      msNothingNew: +time(() => memo.sites([...dabs, drag], w, h, 'wrap'), 5).toFixed(2),
      msNewGrid: +time(() => flowSites([...dabs, drag], w, h, 'wrap'), 3).toFixed(1),
    }),
  );
}
