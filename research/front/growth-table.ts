// The table of the survey of the growth (growth-survey.gpu.test.ts; GROWTH-SURVEY.md): one line per run, from its
// record file in the folder. Usage:
//   node --import ./research/flow/register.mjs research/front/growth-table.ts [research/front/out/survey]
// A line: the peak of the alive agents and its step, the agents at the end and their gain per step over the last
// 4,000 steps, the most that a strain held of its capacity, the shares of the open ground (over the strains) that is
// fresh (open for births and not reached by the plasm) at the peak and at the end and that is closed for births
// (D < 0.01) at the end, the covered food sites, and with the rules the growth of the territory per step, the paid
// claims K and the budget B after a growth step, the share of the territory that is closed, and the agents per cell
// of the territory.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS } from '../../src/model/presets';

interface Strain {
  alive: number;
  capacity: number;
  reached: number;
  fresh: number;
  closed: number;
  closedReached: number;
  covered: number | null;
  territory?: number;
  state?: Record<string, number>;
  census: Record<string, number>;
}
interface Row {
  step: number;
  alive: number;
  strains: Strain[];
}
interface Head {
  run: string;
  open: number;
  rules: boolean;
  increment: number;
  capacity: number[];
  sites: number;
  growth: number[];
}
interface End {
  peak: number;
  peakStep: number;
  end: number;
  ms: number;
}

export interface Summary {
  run: string;
  peak: number;
  peakStep: number;
  end: number;
  /** The gain of agents per step over the last 4,000 steps, and as a share of the agents 4,000 steps before the end. */
  gain: number;
  rise: number;
  /** The share of the open ground (over the strains) within half a window of growth of plasm at the end. */
  reached: number;
  capacity: number;
  /** The most that one strain held of its capacity at a record. */
  full: number;
  /** Shares of the open ground of each strain, summed over the strains. */
  freshAtPeak: number;
  fresh: number;
  closed: number;
  /** The closed cells as a share of the ground that the colony holds or held: the closed and the reached cells. */
  closedHeld: number;
  covered: number;
  sites: number;
  rules: boolean;
  increment: number;
  /** With the rules: the cells that the territory gains per step over the last 4,000 steps. */
  push: number;
  /** With the rules, the medians over the records of the last 4,000 steps right after a growth step. */
  claims: number;
  budget: number;
  /** With the rules: the share of the territory that is closed for births, and the agents per cell of it. */
  closedTerritory: number;
  perCell: number;
  minutes: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] ?? 0) : 0;
};

export function summarize(text: string): Summary | undefined {
  const lines = text.trim().split('\n');
  const head = JSON.parse(lines[0] ?? '{}') as Head;
  const end = JSON.parse(lines[lines.length - 1] ?? '{}') as Partial<End>;
  if (end.peak === undefined) return undefined; // the run has not ended
  const rows = lines.slice(1, -1).map((l) => JSON.parse(l) as Row);
  const last = rows[rows.length - 1];
  if (!last) return undefined;
  const late = rows.filter((r) => r.step >= last.step - 4000);
  const first = late[0] ?? last;
  const span = Math.max(1, last.step - first.step);
  const ground = head.open * last.strains.length;
  const sum = (r: Row, f: (s: Strain) => number) => r.strains.reduce((a, s) => a + f(s), 0);
  const atPeak = rows.reduce((a, r) =>
    Math.abs(r.step - (end.peakStep ?? 0)) < Math.abs(a.step - (end.peakStep ?? 0)) ? r : a,
  );
  // The record after step s shows the state of the step s − 1: a growth step if s − 1 is a multiple of growthEvery.
  const every = head.growth[0] ?? 3;
  const grown = late.filter((r) => every > 0 && (r.step - 1) % every === 0);
  const lane = (name: string) => grown.map((r) => sum(r, (s) => s.state?.[name] ?? 0));
  const territory = sum(last, (s) => s.territory ?? 0);
  return {
    run: head.run,
    peak: end.peak,
    peakStep: end.peakStep ?? 0,
    end: end.end ?? 0,
    gain: (last.alive - first.alive) / span,
    rise: (last.alive - first.alive) / Math.max(1, first.alive),
    reached: sum(last, (s) => s.reached) / ground,
    capacity: head.capacity.reduce((a, b) => a + b, 0),
    full: Math.max(...rows.flatMap((r) => r.strains.map((s) => s.alive / Math.max(1, s.capacity)))),
    freshAtPeak: sum(atPeak, (s) => s.fresh) / ground,
    fresh: sum(last, (s) => s.fresh) / ground,
    closed: sum(last, (s) => s.closed) / ground,
    closedHeld:
      sum(last, (s) => s.closed) /
      Math.max(
        1,
        sum(last, (s) => s.closed + s.reached - s.closedReached),
      ),
    covered: sum(last, (s) => s.covered ?? 0),
    sites: head.sites,
    rules: head.rules,
    increment: head.increment,
    push: (territory - sum(first, (s) => s.territory ?? 0)) / span,
    claims: median(lane('claims')),
    budget: median(lane('budget')),
    closedTerritory: territory > 0 ? sum(last, (s) => s.closed) / territory : 0,
    perCell: territory > 0 ? last.alive / territory : 0,
    minutes: (end.ms ?? 0) / 60000,
  };
}

/**
 * The limit that acts at the end of a run (GROWTH-SURVEY.md): the capacity when a strain held at least 95 % of its
 * capacity; else, while the count still rises (at the end at least 85 % of the peak and 2 % above the count of 4,000
 * steps before), the budget of the paid births with the rules and none without them; else the closed ground when the
 * flow has closed at least a third of the ground that the colony holds or held; else the density of Jones' rule.
 */
export function limitOf(s: Summary): string {
  if (s.full >= 0.95) return 'capacity';
  if (s.end >= 0.85 * s.peak && s.rise >= 0.02) return s.rules ? 'budget' : 'none';
  if (s.closedHeld >= 1 / 3) return 'closed ground';
  return 'density';
}

const pct = (x: number) => `${(100 * x).toFixed(0)} %`;

/** The scene, the case and the tag of a lever of a run: `food-ring-rules-on-strength8`. */
const partsOf = (run: string) => {
  const m = /^(.*)-(as-is|rules-on|rules-off)(?:-(.*))?$/.exec(run);
  return { scene: m?.[1] ?? run, kind: m?.[2] ?? '', tag: m?.[3] ?? '' };
};

const thousands = (n: number) => Math.round(n).toLocaleString('en-US');

/** A row of the table of GROWTH-SURVEY.md. */
function markdown(s: Summary): string {
  const { scene, kind, tag } = partsOf(s.run);
  const limit = limitOf(s);
  const why =
    limit === 'budget'
      ? `rises by ${s.gain.toFixed(2)} agents per step; the budget by ${s.increment.toFixed(2)} per step and strain`
      : s.closedHeld > 0.005
        ? `${pct(s.closedHeld)} of its ground closed`
        : 'no ground closed';
  const full = s.full >= 0.5 ? `; a strain at ${pct(s.full)} of its capacity` : '';
  const rules = `${s.rules ? 'on' : 'off'} (${kind === 'as-is' ? 'scene' : 'patch'})`;
  const name = (PRESETS.find((p) => p.id === scene)?.name ?? scene) + (tag ? `, ${tag}` : '');
  const peak = `${thousands(s.peak)} (${thousands(s.peakStep)})`;
  return `| ${[name, rules, peak, thousands(s.end), limit, why + full].join(' | ')} |`;
}

if (process.argv[1]?.endsWith('growth-table.ts')) {
  const dir = process.argv[2] ?? 'research/front/out/survey';
  const mode = process.argv[3] ?? '';
  let minutes = 0;
  const order = (run: string) => {
    const { scene, kind, tag } = partsOf(run);
    const i = PRESETS.findIndex((p) => p.id === scene);
    return `${tag ? 1 : 0}-${String(i).padStart(3, '0')}-${kind === 'as-is' ? 0 : 1}-${tag}`;
  };
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort((a, b) => order(a.replace('.jsonl', '')).localeCompare(order(b.replace('.jsonl', ''))));
  for (const f of files) {
    const s = summarize(readFileSync(join(dir, f), 'utf8'));
    if (!s) {
      console.log(`${f}: not ended`);
      continue;
    }
    minutes += s.minutes;
    if (mode === 'md') {
      console.log(markdown(s));
      continue;
    }
    if (mode === 'short') {
      const kept = s.end / Math.max(1, s.peak);
      console.log(
        `${s.run}: ${s.peak} @${s.peakStep} -> ${s.end} (${pct(kept)}), rise ${pct(s.rise)}, closed ${pct(s.closed)}` +
          ` reached ${pct(s.reached)}, full ${pct(s.full)}: ${limitOf(s)}`,
      );
      continue;
    }
    const rules = s.rules
      ? ` | push ${s.push.toFixed(2)}/step, K ${s.claims} B ${s.budget.toFixed(2)} (+${s.increment.toFixed(2)}/step),` +
        ` closed ${pct(s.closedTerritory)} of terr, ${s.perCell.toFixed(2)}/cell`
      : '';
    console.log(
      `${s.run}: peak ${s.peak} @${s.peakStep}, end ${s.end}, gain ${s.gain.toFixed(3)}/step, full ${pct(s.full)}` +
        ` | fresh ${pct(s.freshAtPeak)} at peak, ${pct(s.fresh)} at end, closed ${pct(s.closed)}` +
        ` | covered ${s.covered}/${s.sites}${rules}`,
    );
  }
  console.log(`GPU minutes: ${minutes.toFixed(1)}`);
}
