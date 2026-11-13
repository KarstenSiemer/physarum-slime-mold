// Runs a campaign of the prototype: the same runs over the seeds of the campaign, several at a time. Each run is one
// script with its arguments, and it writes its log to research/flow/out/<campaign>/<name>.jsonl. The lists are the
// campaigns of 2026-11-12 (ADR 0029, tables (a) and (b)) and the rules that the ADR rejects (decisions 5 and 8).
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/campaign.ts <campaign> [jobs=6] [seeds=1,2] [dry=1]
// jobs: the runs at a time; without it half of the cores. seeds: other seeds than those of the campaign. dry=1: print
// the runs and start none.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { outDir } from './out.ts';

const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** The coupling of the flow to the agents in every run with a flow: starvation, births and the adaptation rate. */
const FLOW = 'flowFrom=500 death=0.02 birth=0.2 rate=0.003';

/** A campaign: the seeds of its record, and the runs for one seed (the script and its arguments). */
interface Campaign {
  seeds: number[];
  runs: (seed: number) => string[];
}
const CAMPAIGNS: Record<string, Campaign> = {
  // Table (a), first rows: one source and one sink at fixed pressures; the exact solver; Ma's walkers; no flow.
  'maze-pair': {
    seeds: TEN,
    runs: (s) => [
      `run-maze.ts name=base-s${s} seed=${s} steps=15000 flowFrom=99999999 pictures=5000,15000`,
      `run-maze.ts name=lag16-s${s} seed=${s} steps=10000 ${FLOW} solver=lag iterations=16 pictures=5000,10000`,
      `run-maze.ts name=lag8-s${s} seed=${s} steps=10000 ${FLOW} solver=lag iterations=8 pictures=10000`,
      `run-maze.ts name=lag32-s${s} seed=${s} steps=10000 ${FLOW} solver=lag iterations=32 pictures=10000`,
      `run-maze.ts name=ma-s${s} seed=${s} steps=10000 ${FLOW} solver=ma walkers=2000 pictures=5000,10000`,
      `run-maze.ts name=exact-s${s} seed=${s} steps=10000 ${FLOW} solver=exact pictures=5000,10000`,
    ],
  },
  // Table (a), last sentence: each food gives or takes a fixed flux, as the app does.
  'maze-sites': {
    seeds: TEN,
    runs: (s) => [
      `run-maze-sites.ts name=mz-lag16-s${s} seed=${s} ${FLOW} steps=10000 iterations=16 pictures=5000,10000`,
      `run-maze-sites.ts name=mz-lag8-s${s} seed=${s} ${FLOW} steps=10000 iterations=8 pictures=10000`,
      `run-maze-sites.ts name=mz-lag32-s${s} seed=${s} ${FLOW} steps=10000 iterations=32 pictures=10000`,
    ],
  },
  // Table (b): the Tokyo layout. The runs that finished on 2026-11-12: a flux of 8 with two seeds, a flux of 4 with
  // one seed, and Ma's walkers with three seeds to step 8,000 (their network was dead long before).
  tokyo: {
    seeds: [1, 2, 3],
    runs: (s) => [
      ...(s <= 2
        ? [`run-tokyo.ts name=tk-i8-s${s} seed=${s} i0=8 steps=20000 measureEvery=1000 pictures=4000,10000,20000`]
        : []),
      ...(s === 1
        ? [`run-tokyo.ts name=tk-i4-s${s} seed=${s} i0=4 steps=20000 measureEvery=1000 pictures=4000,10000,20000`]
        : []),
      ...(s <= 3
        ? [
            `run-tokyo.ts name=tk-walk-s${s} seed=${s} i0=8 mode=walkers steps=8000 measureEvery=1000 pictures=4000,8000`,
          ]
        : []),
    ],
  },
  // The rules that decisions 5 and 8 of the ADR reject, one run each with seed 1 (2026-11-13).
  alternatives: {
    seeds: [1],
    runs: (s) => [
      // The flow memory scales the deposit of an agent (lo, hi), and no agent starves (death is 0 without the argument).
      `run-maze.ts name=maze-deposit-only-s${s} seed=${s} steps=6000 flowFrom=500 rate=0.003 solver=lag iterations=16 lo=0.3 hi=2.3 pictures=6000`,
      // Agents starve, and no dead agent comes to life.
      `run-maze.ts name=maze-no-births-s${s} seed=${s} steps=10000 flowFrom=500 rate=0.003 solver=lag iterations=16 death=0.02 birth=0 pictures=10000`,
      // One random pair of foods per field, held for 300 steps.
      `run-tokyo.ts name=tokyo-pairs-s${s} seed=${s} i0=8 terminals=pairs steps=8000 measureEvery=1000 pictures=8000`,
      // Each food at a fixed pressure, and not with a fixed flux.
      `run-tokyo.ts name=tokyo-pressure-s${s} seed=${s} i0=8 mode=pressure steps=8000 measureEvery=1000 pictures=8000`,
    ],
  },
};

const [campaign = '', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => a.split('=') as [string, string]));
const chosen = CAMPAIGNS[campaign];
if (!chosen) {
  console.error(`Unknown campaign "${campaign}". Campaigns: ${Object.keys(CAMPAIGNS).join(', ')}`);
  process.exit(1);
}
const seeds = args.seeds ? args.seeds.split(',').map(Number) : chosen.seeds;
const jobs = Math.max(1, Number(args.jobs ?? Math.max(1, Math.floor(availableParallelism() / 2))));
const queue = seeds.flatMap((s) => chosen.runs(s));
if (queue.length === 0) {
  console.error(`The campaign "${campaign}" has no run for the seeds ${seeds.join(', ')}.`);
  process.exit(1);
}
if (args.dry) {
  console.log(queue.join('\n'));
  process.exit(0);
}
const out = outDir(`${campaign}/`);
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const t0 = performance.now();
let [running, done, failed] = [0, 0, 0];

function next() {
  while (running < jobs && queue.length > 0) {
    const [script = '', ...argv] = (queue.shift() ?? '').split(' ');
    const name = /name=(\S+)/.exec(argv.join(' '))?.[1] ?? script;
    const child = spawn(process.execPath, ['--import', here('../register.mjs'), here(script), ...argv], {
      env: { ...process.env, SUB: `${campaign}/` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = createWriteStream(`${out}log-${name}.txt`);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    running++;
    child.on('close', (code) => {
      running--;
      done++;
      if (code !== 0) failed++;
      const minutes = ((performance.now() - t0) / 60000).toFixed(1);
      console.log(
        `${name}: ${code === 0 ? 'done' : `failed with code ${String(code)}`} (${done} runs, ${minutes} min)`,
      );
      next();
    });
  }
  if (running === 0 && queue.length === 0) {
    console.log(`campaign ${campaign}: ${done} runs, ${failed} failed, logs in ${out}`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
}
next();
