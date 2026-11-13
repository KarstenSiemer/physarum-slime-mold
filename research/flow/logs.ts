// The logs of the runs behind ADR 0029 are one archive in the repository: logs.tar.gz (the owner's decision of
// 2026-11-13: 125 log files were too much data for a person who reads the repository). This script unpacks the
// archive to research/flow/logs/, which git ignores, and packs that folder again after a new campaign.
// Usage: node --import ./research/flow/register.mjs research/flow/logs.ts [unpack | pack | list]
// The archive is a plain tar.gz: `tar -xzf research/flow/logs.tar.gz -C research/flow` unpacks it too.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** The archive of the record. */
export const ARCHIVE = join(HERE, 'logs.tar.gz');
/** A tar archive is made of blocks of this size: a header block per file, then the bytes of the file. */
const BLOCK = 512;

/** A file of the archive: its path in it ("logs/maze-pair/base-s1.jsonl") and its bytes. */
export interface Entry {
  name: string;
  data: Buffer;
}

/** The files of an archive, in its order. */
export function readArchive(file = ARCHIVE): Entry[] {
  const tar = gunzipSync(readFileSync(file));
  const files: Entry[] = [];
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const head = tar.subarray(at, at + BLOCK);
    // Blocks of zeros end an archive.
    if (head.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) => {
      const field = head.subarray(from, from + length);
      const end = field.indexOf(0);
      return field.subarray(0, end < 0 ? length : end).toString('utf8');
    };
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const kind = text(156, 1);
    const prefix = text(345, 155);
    at += BLOCK;
    // '0' or no flag is a file. A folder holds no bytes, and the extra headers of other tar programs hold no log.
    if (kind === '0' || kind === '') {
      files.push({ name: (prefix ? `${prefix}/` : '') + text(0, 100), data: tar.subarray(at, at + size) });
    }
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/** Writes the files of the archive below `into`, the folder that then holds `logs/`. Gives the number of files. */
export function unpackLogs(into = HERE, file = ARCHIVE): number {
  const root = resolve(into);
  const files = readArchive(file);
  for (const { name, data } of files) {
    const target = resolve(root, name);
    // A path of an archive must not leave the folder.
    if (!target.startsWith(root + sep)) throw new Error(`the archive holds a path outside the folder: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return files.length;
}

/**
 * Packs the folder `logs/` below `from` into an archive: the files in the order of their names, without times and
 * owners, so that the same logs give the same archive on one machine. Gives the number of files.
 */
export function packLogs(from = HERE, file = ARCHIVE): number {
  const names: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(join(from, folder)).sort()) {
      const path = `${folder}/${entry}`;
      if (statSync(join(from, path)).isDirectory()) walk(path);
      // No hidden files: a file manager puts its own files into a folder.
      else if (!entry.startsWith('.')) names.push(path);
    }
  };
  walk('logs');
  const blocks: Buffer[] = [];
  for (const name of names) {
    if (Buffer.byteLength(name) > 100) throw new Error(`the name is too long for the archive: ${name}`);
    const data = readFileSync(join(from, name));
    const head = Buffer.alloc(BLOCK);
    head.write(name, 0);
    head.write('0000644\0', 100); // the mode: a plain file
    head.write('0000000\0', 108); // no owner
    head.write('0000000\0', 116); // no group
    head.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    head.write('00000000000\0', 136); // no time
    head.write('        ', 148); // the checksum counts its own field as eight spaces
    head.write('0', 156); // a file
    head.write('ustar\x0000', 257);
    const sum = head.reduce((total, byte) => total + byte, 0);
    head.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(head, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(2 * BLOCK));
  writeFileSync(file, gzipSync(Buffer.concat(blocks), { level: 9 }));
  return names.length;
}

// Only when Node runs this file as a script, and not when a test loads it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? 'unpack';
  if (action === 'unpack') console.log(`${unpackLogs()} logs are in ${join(HERE, 'logs')}`);
  else if (action === 'pack') console.log(`${packLogs()} logs are in ${ARCHIVE}`);
  else if (action === 'list') {
    for (const { name, data } of readArchive()) console.log(`${String(data.length).padStart(8)}  ${name}`);
  } else {
    console.error('Usage: logs.ts [unpack | pack | list]');
    process.exit(1);
  }
}
