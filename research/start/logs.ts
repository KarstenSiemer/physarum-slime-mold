// The logs of ADR 0049 (the start of the app on WebGPU) are one archive, logs.tar.gz (README.md). This script unpacks it
// to research/start/logs/, which git ignores, and packs that folder again after a new measurement, with the functions
// of research/flow/logs.ts.
// Usage: node --import ./research/flow/register.mjs research/start/logs.ts [unpack | pack | list]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLogs } from '../flow/logs.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
runLogs(process.argv[2] ?? 'unpack', HERE, join(HERE, 'logs.tar.gz'));
