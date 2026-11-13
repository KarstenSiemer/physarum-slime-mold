// The commands of README.md still give the numbers of the record (ADR 0029, decision 16). Each check runs a script
// of this folder as a person would, with Node and register.mjs, and compares what it gives with the logs in logs/.
//
// The quick checks always run (2 s). The reruns of the prototype and of the solver loop take 25 s on an M3 Pro, all at
// the same time: they run on CI, and locally with `RESEARCH=full npm test` (ADR 0010).
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/** Runs a script of this folder that may end with an error; gives its exit code and all that it printed. */
async function ended(file: string, args: string[]): Promise<{ code: number; text: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, ['--import', here('./register.mjs'), here(file), ...args]);
    return { code: 0, text: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, text: (failed.stdout ?? '') + (failed.stderr ?? '') };
  }
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

// At the same time: each check starts one or two Node processes, and no check reads what another one wrote.
describe.concurrent('the campaigns, and the comparison of a rerun with the record', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'research-flow-'));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
  const record = here('./logs/alternatives/');
  const log = 'tokyo-pairs-s1.jsonl';
  /** A folder with one log: the lines of the record's log after `change`. */
  function rerun(folder: string, name: string, change: (lines: string[]) => string[]): string {
    const dir = join(scratch, folder);
    mkdirSync(dir);
    writeFileSync(
      join(dir, name),
      change(
        readFileSync(record + log, 'utf8')
          .trim()
          .split('\n'),
      ).join('\n') + '\n',
    );
    return dir;
  }

  it.each(['maze-pair', 'maze-sites', 'tokyo', 'alternatives'])(
    'names the runs of the campaign %s as the logs of the record',
    async (campaign) => {
      const { code, text } = await ended('prototype/campaign.ts', [campaign, 'dry=1']);
      expect(code).toBe(0);
      const names = [...text.matchAll(/ name=(\S+)/g)].map((m) => `${m[1] ?? ''}.jsonl`);
      const logs = readdirSync(here(`./logs/${campaign}/`)).filter((file) => file.endsWith('.jsonl'));
      expect(names.sort()).toEqual(logs.sort());
    },
  );

  it('prints the lines of the tables that the guide quotes', async () => {
    const pair = await ended('summary.ts', ['maze-campaign', here('./logs/maze-pair/'), 'lag16', 'exact', 'ma']);
    expect(pair.code).toBe(0);
    const block = (name: string) => pair.text.split('== ').find((part) => part.startsWith(`${name}:`)) ?? '';
    expect(block('lag16')).toContain('dead ends below 10% of the route: 10 of 10 runs; step 2500 (2500 to 3250, n 10)');
    expect(block('exact')).toContain('dead ends below 10% of the route: 10 of 10 runs; step 2250 (2250 to 2500, n 10)');
    // With Ma's walkers the network dies: the table of the ADR has "(no network)" in this row.
    expect(block('ma')).toContain('NO NETWORK in 10 of 10 runs');
    expect(block('lag16')).not.toContain('NO NETWORK');
    const sites = await ended('summary.ts', ['maze-campaign', here('./logs/maze-sites/'), 'mz-lag16']);
    expect(sites.text).toContain('dead ends below 10% of the route: 10 of 10 runs; step 2125 (2000 to 2250, n 10)');
    const tokyo = await ended('summary.ts', ['tokyo-campaign', here('./logs/tokyo/'), 'tk-i8', 'tk-walk']);
    expect(tokyo.text).toContain('step   2000 alive  3947 | 33: 33 joined, 49 links, TL 1.60 MD 0.83 FT 0.88');
    expect(tokyo.text.match(/33: 1 joined/g)).toHaveLength(21);
  });

  it('passes a rerun that equals the record', async () => {
    const { code, text } = await ended('summary.ts', ['compare', rerun('equal', log, (lines) => lines), record]);
    expect(text).toContain(`${log}: all 8 rows equal`);
    expect(text).toContain('1 of 1 logs of the rerun equal the record');
    expect(code).toBe(0);
  });

  it('fails a rerun that stopped early', async () => {
    const short = rerun('short', log, (lines) => lines.slice(0, 5));
    const { code, text } = await ended('summary.ts', ['compare', short, record]);
    expect(text).toContain(`${log}: 4 rows equal, but the rerun has 4 rows and the record 8`);
    expect(code).toBe(1);
  });

  it('fails a rerun with another number in a row, and names the step', async () => {
    const changed = rerun('changed', log, (lines) => lines.map((l) => l.replace('"alive":1044,', '"alive":1045,')));
    const { code, text } = await ended('summary.ts', ['compare', changed, record]);
    expect(text).toContain(`${log}: DIFFERENT from the row of step 2000 on`);
    expect(code).toBe(1);
  });

  it('fails a rerun whose log the record does not have, and a folder that is not there', async () => {
    const other = rerun('other', 'other-s1.jsonl', (lines) => lines);
    const unknown = await ended('summary.ts', ['compare', other, record]);
    expect(unknown.text).toContain('other-s1.jsonl: NOT IN THE RECORD');
    expect(unknown.code).toBe(1);
    const missing = await ended('summary.ts', ['compare', join(scratch, 'nothing'), record]);
    expect(missing.text).toContain('no folder');
    expect(missing.code).toBe(1);
  });
});
