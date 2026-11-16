// What one start of the app costs on WebGPU in the image of CI, part by part (ADR 0049, README.md). Not a test of the
// app: it runs only with the configuration of this folder, in the image of CI (run.sh). It prints its numbers in
// lines that start with "START".
import { chromium, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webgpuLaunch } from '../../tests/browser';
import { smallScene } from '../../tests/e2e/helpers';

// One run at a time: the runs share the CPU, and each measures time.
test.describe.configure({ mode: 'serial' });

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Opens the small scene of the e2e tests and prints how long the engine and its first 5 steps took. */
async function start(page: Page, label: string, url?: string) {
  const t0 = Date.now();
  if (url !== undefined || page.url() === 'about:blank') await page.goto(url ?? (await smallScene()));
  else await page.reload();
  await page.waitForFunction(() => globalThis.physarum !== undefined, undefined, { timeout: 300_000 });
  const engine = Date.now();
  await page.waitForFunction(() => (globalThis.physarum?.sim.step ?? 0) > 5, undefined, { timeout: 300_000 });
  console.log(`START ${label}: engine ${s(engine - t0)}, step 5 ${s(Date.now() - t0)}`);
}

// Builds the pipelines of createComputePipelineAsync one at a time: the time of each is then its own.
const oneAtATime = () => {
  const log: string[] = [];
  (globalThis as unknown as { pipelines: string[] }).pipelines = log;
  const D = GPUDevice.prototype;
  const build = Reflect.get<GPUDevice, 'createComputePipelineAsync'>(D, 'createComputePipelineAsync');
  let last: Promise<unknown> = Promise.resolve();
  D.createComputePipelineAsync = function (this: GPUDevice, d: GPUComputePipelineDescriptor) {
    const next = last.then(async () => {
      const t0 = performance.now();
      const p = await build.call(this, d);
      const constants = d.compute.constants ? ` ${JSON.stringify(d.compute.constants)}` : '';
      log.push(`${d.compute.entryPoint ?? '?'}${constants}: ${((performance.now() - t0) / 1000).toFixed(2)} s`);
      return p;
    });
    last = next;
    return next;
  };
};

// Only one page runs at a time: a page left open steps on, and its frames slow the compiler down about three times.
test('one start, and the pipelines of a start one at a time', async ({ page }) => {
  test.setTimeout(600_000);
  await start(page, 'new page');
  const context = page.context();
  await page.close();
  const other = await context.newPage();
  await other.addInitScript(oneAtATime);
  await start(other, 'one pipeline at a time');
  const lines = await other.evaluate(() => (globalThis as unknown as { pipelines: string[] }).pipelines);
  for (const line of lines) console.log(`START   ${line}`);
  await other.close();
  await start(await context.newPage(), 'WebGL2', (await smallScene()).replace('/#', '/?backend=webgl2#'));
});

// A second start of the same pipelines: the same page again, a new page of the same context, a profile on disk, and
// two flags of Dawn and one of Chromium.
test('a second start', async ({ page }) => {
  test.setTimeout(900_000);
  await start(page, 'new page');
  await start(page, 'the same page again');
  const context = page.context();
  await page.close();
  const other = await context.newPage();
  await start(other, 'a new page of the same context');
  await other.close();
  const profile = mkdtempSync(join(tmpdir(), 'start-profile-'));
  for (const label of ['a profile on disk', 'the same profile again']) {
    const persistent = await chromium.launchPersistentContext(profile, webgpuLaunch);
    await start(await persistent.newPage(), label, `http://localhost:4173${await smallScene()}`);
    await persistent.close();
  }
  for (const flag of [
    '--enable-dawn-features=disable_robustness',
    '--enable-dawn-features=skip_validation',
    '--enable-features=WebGPUBlobCache',
  ]) {
    // Chromium reads only the last of two equal switches: a feature joins the list of the switch that is there.
    const [name = '', value = ''] = flag.split('=');
    const args = [...webgpuLaunch.args];
    const at = args.findIndex((a) => a.startsWith(`${name}=`));
    if (at < 0) args.push(flag);
    else args[at] = `${args[at] ?? ''},${value}`;
    const browser = await chromium.launch({ ...webgpuLaunch, args });
    const p = await browser.newPage();
    await start(p, flag, `http://localhost:4173${await smallScene()}`);
    await start(p, `${flag}, the same page again`);
    await browser.close();
  }
});
