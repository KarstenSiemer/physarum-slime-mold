// Where the scripts of this folder write their logs and pictures: research/flow/out/, which git ignores.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The output folder, with `sub` as a folder below it (the name of a campaign). It exists after the call. */
export function outDir(sub = ''): string {
  const dir = fileURLToPath(new URL(`../out/${sub}`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir.endsWith('/') ? dir : `${dir}/`;
}
