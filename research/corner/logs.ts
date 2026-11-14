// The logs of the amendment of ADR 0025 of 2026-11-13 are one archive, logs.tar.gz (README.md). This script unpacks it
// to research/corner/logs/, which git ignores, and packs that folder again after a new campaign, with the functions of
// research/flow/logs.ts.
// Usage: node --import ./research/flow/register.mjs research/corner/logs.ts [unpack | pack | list]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLogs } from '../flow/logs.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
runLogs(process.argv[2] ?? 'unpack', HERE, join(HERE, 'logs.tar.gz'));
