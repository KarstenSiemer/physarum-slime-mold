// The territory of each strain, the first rule of stage 4 (ADR 0068; ADR 0065, decision 1; ADR 0067, decisions 4 and
// 6 to 9). Each strain has a territory, a set of cells. An agent moves, comes to life and is born only onto a cell of
// the territory of its strain. A cell joins the territory of a strain when it holds an agent of the strain, and an
// open cell outside it joins it with a chance for each agent of the strain beside it: the push. The territory never
// shrinks. The passes are in shaders/territory.wgsl and gl/glsl/territory.frag, the CPU copy in
// territory-reference.ts.
import type { Settings } from '../model/params';
import { FLOW_TERRITORY_SLOT, flowOn } from './flow';
import { growthOn } from './pack';
import { packPaid } from './paid';
import { packSinks } from './sinks';

/** The constants of the territory (ADR 0065, decision 1; `speed` and the start in research/front/sim.ts). */
export const TERRITORY = {
  /** The chance per step that one agent of a strain beside an open cell outside its territory pushes the cell in. */
  speed: 0.004,
  /** The cells that the start territory reaches beyond the disc of the start layout Food (ADR 0067, decision 4). */
  rim: 3,
} as const;

/** The random stream of the push for strain s is PUSH + 65536 · s, one draw per cell (docs/model.md, 7.7). */
export const PUSH = 11;

/**
 * Whether the rules of stage 4 run (ADR 0068): the setting, in the extended model with growth and the flow, as the
 * rule set of ADR 0065 has them. Growth needs one agent per cell (growthOn()), and so do the owners and the push.
 */
export const territoryOn = (s: Pick<Settings, 'territory' | 'flow' | 'model' | 'growth' | 'collisions'>) =>
  s.territory && flowOn(s) && growthOn(s);

/**
 * The chance that n agents of a strain push an open cell outside its territory into it in one step, for n = 1 to 8:
 * 1 − (1 − speed)^n, computed once here and rounded to f32. The push compares its draw with these numbers, so both
 * backends and the CPU copy decide alike in every case: `pow` is not exact in WGSL or in GLSL.
 */
export const PUSH_CHANCES: readonly number[] = Array.from({ length: 8 }, (_, k) =>
  Math.fround(1 - (1 - TERRITORY.speed) ** (k + 1)),
);

/**
 * Writes the constants of stage 4 into the uniform block of the flow (`buf` from flow.ts packFlow()), after its sites
 * (FLOW_TERRITORY_SLOT; ADR 0067, decision 9): PUSH_CHANCES, then the constants of the sinks with the flux to the front
 * of the settings (sinks.ts packSinks(), ADR 0086), then the growth of the budget of the paid births (paid.ts
 * packPaid()). Returns `buf`.
 */
export function packTerritory(buf: ArrayBuffer, s: Pick<Settings, 'frontFlux'>): ArrayBuffer {
  const f = new Float32Array(buf);
  f.set(PUSH_CHANCES, FLOW_TERRITORY_SLOT * 4);
  packSinks(f, s.frontFlux);
  packPaid(f);
  return buf;
}
