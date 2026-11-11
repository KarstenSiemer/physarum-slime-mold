// Texts about a scene that come from its settings, and the check whether the user changed them.
import { strainSpec, type Settings, type Strain, type StrainKey } from './params';
import type { EnvShape } from './presets';

export const letter = (i: number) => 'ABCD'[i] ?? String(i + 1);

/** A number as people write it: at most 3 significant digits (1 decimal from 100 on), no trailing zeros. */
export function fmt(v: number): string {
  const r = Math.abs(v) >= 100 ? Number(v.toFixed(1)) : Number(v.toPrecision(3));
  return Object.is(r, -0) ? '0' : String(r);
}

/** A weight with its sign, with a real minus sign: +1, −0.7. */
export const signed = (v: number) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0');

/** "A", "A and B", "A, B and C". */
export function list(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/** How a strain reacts to each trail: "follows A (+1), flees B and C (−0.7)". */
export function relations(s: Settings, i: number): string {
  const row = s.strains[i]?.attraction ?? [];
  const n = s.strains.length;
  if (n === 1) {
    const w = row[0] ?? 0;
    return w > 0
      ? `follows its own trail (${signed(w)})`
      : w < 0
        ? `flees its own trail (${signed(w)})`
        : 'ignores its own trail';
  }
  // Strains with the same weight share one phrase; followed trails come first, then fled, then ignored ones.
  const groups = new Map<number, string[]>();
  for (let j = 0; j < n; j++) {
    const w = Number(fmt(row[j] ?? 0));
    groups.set(w, [...(groups.get(w) ?? []), letter(j)]);
  }
  const rank = (w: number) => (w > 0 ? 0 : w < 0 ? 1 : 2);
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([w, who]) =>
      w > 0
        ? `follows ${list(who)} (${signed(w)})`
        : w < 0
          ? `flees ${list(who)} (${signed(w)})`
          : `ignores ${list(who)}`,
    )
    .join(', ');
}

/** The numbers of one strain, from the live settings: "sensor angle 22.5°, rotation 45°, …". */
export function strainNumbers(s: Settings, i: number, env: readonly EnvShape[] = []): string {
  const st = s.strains[i];
  if (!st) return '';
  const parts = [
    `sensor angle ${fmt(st.sensorAngle)}°`,
    `rotation ${fmt(st.rotationAngle)}°`,
    `sensor distance ${fmt(st.sensorOffset)}`,
    `step ${fmt(st.stepSize)}`,
    `decay ${fmt(st.decay)}`,
  ];
  if (st.deposit !== 5) parts.push(`deposit ${fmt(st.deposit)}`);
  if (st.randomTurn > 0) parts.push(`random turn ${fmt(st.randomTurn)}`);
  parts.push(relations(s, i));
  if (env.some((e) => e.kind === 'food')) parts.push(`food ${signed(st.food)}`);
  if (env.some((e) => e.kind === 'light')) parts.push(`light avoidance ${signed(st.light)}`);
  return parts.join(', ');
}

/** Settings that change the look or the pace, not the model. The seed is drawn anew on every load. */
const NOT_MODEL = new Set<keyof Settings>(['seed', 'style', 'exposure', 'bloom', 'speed', 'strains']);
const STRAIN_KEYS = Object.keys(strainSpec) as StrainKey[];

/** Same numbers, and the same weights on the trails of the `n` strains that exist. */
function sameStrain(a: Strain, b: Strain, n: number): boolean {
  return (
    STRAIN_KEYS.every((k) => a[k] === b[k]) &&
    Array.from({ length: n }, (_, j) => j).every((j) => (a.attraction[j] ?? 0) === (b.attraction[j] ?? 0))
  );
}

/**
 * True when a model parameter differs. Look, speed, strain colors and the seed do not count, and neither do
 * weights on the trails of strains that do not exist: the GPU never gets them (packParams in engine/pack.ts).
 */
export function modelChanged(current: Settings, base: Settings): boolean {
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    if (!NOT_MODEL.has(k) && current[k] !== base[k]) return true;
  }
  const n = current.strains.length;
  if (n !== base.strains.length) return true;
  return current.strains.some((st, i) => {
    const b = base.strains[i];
    return b === undefined || !sameStrain(st, b, n);
  });
}
