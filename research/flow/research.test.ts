// The commands of README.md still give the numbers of the record (ADR 0029, decision 16). Each check runs a script
// of this folder as a person would, with Node and register.mjs, and compares what it gives with the logs in logs/.
//
// The quick checks always run (2 s). The reruns of the prototype and of the solver loop take 25 s on an M3 Pro, all at
// the same time: they run on CI, and locally with `RESEARCH=full npm test` (ADR 0010).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const exec = promisify(execFile);
const FULL = Boolean(process.env.CI) || process.env.RESEARCH === 'full';

/** Runs a script of this folder; gives what it printed. Its logs go to out/check/. */
async function script(file: string, args: string[] = []): Promise<string> {
  const { stdout } = await exec(process.execPath, ['--import', here('./register.mjs'), here(file), ...args], {
    env: { ...process.env, SUB: 'check/' },
    maxBuffer: 1 << 24,
  });
  return stdout;
}

/** The rows of a log without the run time `s`, which differs from run to run. */
const rows = (file: string) =>
  readFileSync(here(file), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => 'step' in row)
    .map((row): Record<string, unknown> => ({ ...row, s: undefined }));

// The coupling of the campaigns (prototype/campaign.ts), to step 750: the flow starts at step 500, so the third row
// of a log holds 250 steps of it.
const FLOW = ['seed=1', 'steps=750', 'flowFrom=500', 'death=0.02', 'birth=0.2', 'rate=0.003', 'pictures=0'];
const RUNS: [log: string, script: string, args: string[]][] = [
  ['maze-pair/lag16-s1', 'prototype/run-maze.ts', ['name=lag16-s1', ...FLOW, 'solver=lag', 'iterations=16']],
  ['maze-pair/exact-s1', 'prototype/run-maze.ts', ['name=exact-s1', ...FLOW, 'solver=exact']],
  ['maze-pair/ma-s1', 'prototype/run-maze.ts', ['name=ma-s1', ...FLOW, 'solver=ma', 'walkers=2000']],
  ['maze-sites/mz-lag16-s1', 'prototype/run-maze-sites.ts', ['name=mz-lag16-s1', ...FLOW, 'iterations=16']],
];

describe('the research code of ADR 0029', () => {
  let ring = '';
  let tokyo = '';
  let solvers = '';
  let isolated = '';
  let grow = '';

  beforeAll(async () => {
    const full = FULL
      ? [
          script('solvers.ts', ['network=300', 'steps=1', 'plain=1']),
          script('bounded.ts', ['scene=grow', 'steps=50']),
          ...RUNS.map(([, file, args]) => script(file, args)),
        ]
      : [];
    [ring, tokyo, isolated, solvers = '', grow = ''] = await Promise.all([
      script('prototype/ring.ts'),
      script('prototype/check-tokyo.ts'),
      script('bounded.ts', ['scene=isolated', 'steps=60']),
      ...full,
    ]);
  }, 600_000);

  it('gives the equilibrium of the ring of Tero et al. 2007 with all three solvers', () => {
    const lines = ring
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { solver: string; mu: number; D1: number; D2: number; expect: number[] });
    expect(lines.map((l) => `${l.solver} ${l.mu}`)).toEqual(
      ['exact', 'lag', 'ma'].flatMap((solver) => [`${solver} 0.8`, `${solver} 1`]),
    );
    for (const l of lines) {
      expect(l.expect).toEqual(l.mu === 1 ? [1, 0] : [0.9297, 0.1419]);
      // The walkers are samples: they are right to three places.
      const places = l.solver === 'ma' ? 3 : 4;
      expect(l.D1, `${l.solver} ${l.mu}`).toBeCloseTo(l.expect[0] ?? NaN, places);
      expect(l.D2, `${l.solver} ${l.mu}`).toBeCloseTo(l.expect[1] ?? NaN, places);
    }
  });

  it.runIf(FULL).each(RUNS)('gives the first rows of the log %s again, bit for bit', (log) => {
    const name = log.split('/')[1] ?? '';
    const again = rows(`./out/check/${name}.jsonl`);
    expect(again.map((r) => r.step)).toEqual([250, 500, 750]);
    expect(again).toEqual(rows(`./logs/${log}.jsonl`).slice(0, 3));
  });

  it('builds the Tokyo map of the campaign: its land and its minimum spanning trees', () => {
    expect(JSON.parse(tokyo.split('\n')[0] ?? '{}')).toEqual({
      land: 44107,
      sites: 42,
      cities: 36,
      mst33: 2.254,
      mst36: 2.569,
      expect: [2.254, 2.569],
    });
    // The tree drawn as tubes measures TL 1, MD 1 and FT 0.
    expect(tokyo).toMatch(/MST 33: \{"joined":33,"cities":33,"links":32,"tl":1\.0*\d*,"md":1,"ft":0\}/);
  });

  it.runIf(FULL)('runs the loop of solvers.ts with the bits of the CPU copy of the pass', () => {
    expect(solvers).toContain('check: the loop of this script gives the bits of flowPressure() over 32 iterations');
    expect(solvers).toMatch(/exact \(conjugate gradients, diagonal preconditioner\): \d+ iterations/);
  });

  it('runs rules.ts with the bits of the CPU copy of the passes while every rule is as built', () => {
    // bounded.ts stops with an error at the first value that differs. Four foods give and take in this scene.
    expect(isolated).toMatch(/step {4}60: as built: mean pressure of the network/);
  });

  it.runIf(FULL)('runs the growing mesh with each rule off', () => {
    expect(grow).toMatch(/^as built +\d+/m);
    expect(grow).toMatch(/^the first version: all four rules off +\d+/m);
  });
});
