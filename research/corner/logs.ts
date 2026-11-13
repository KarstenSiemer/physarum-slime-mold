// The logs of the amendment of ADR 0025 of 2026-11-13 are one archive, logs.tar.gz (README.md). This script unpacks it
// to research/corner/logs/, which git ignores, and packs that folder again after a new campaign, with the functions of
// research/flow/logs.ts.
// Usage: node --import ./research/flow/register.mjs research/corner/logs.ts [unpack | pack | list]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packLogs, readArchive, unpackLogs } from '../flow/logs.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ARCHIVE = join(HERE, 'logs.tar.gz');

const action = process.argv[2] ?? 'unpack';
if (action === 'unpack') console.log(`${String(unpackLogs(HERE, ARCHIVE))} logs are in ${join(HERE, 'logs')}`);
else if (action === 'pack') console.log(`${String(packLogs(HERE, ARCHIVE))} logs are in ${ARCHIVE}`);
else if (action === 'list') {
  for (const { name, data } of readArchive(ARCHIVE)) console.log(`${String(data.length).padStart(8)}  ${name}`);
} else {
  console.error('Usage: logs.ts [unpack | pack | list]');
  process.exit(1);
}
