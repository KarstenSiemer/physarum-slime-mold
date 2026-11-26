// The table of the isolating study of ADR 0100, part A (ywhy.sh): per case the choice, the first food, the share of
// the steps in which the budget covers the agents of the front, and the births by kind on the blank arm and on the
// arm with slime, medians over the seeds.
// Usage: node --import ./research/flow/register.mjs research/front/ywhy-table.ts research/front/out/<name> [case ...]
import { readFileSync, readdirSync } from 'node:fs';

const dir = process.argv[2] ?? 'research/front/out/ywhy';
const cases =
  process.argv.length > 3
    ? process.argv.slice(3)
    : readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.slice(0, -6));
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? NaN : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
interface Kinds {
  jones: number;
  front: number;
  respawn: number;
  starve: number;
  crowd: number;
}
interface Rec {
  chosen: string;
  first: number;
  full: number;
  byPart: { blank: Kinds; slime: Kinds; base: Kinds };
}
console.log(
  '| Case | Blank : slime | First food | Budget covers the front | Front births, blank; slime | Jones, blank; slime | Respawns, blank; slime |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const c of cases) {
  const recs = readFileSync(`${dir}/${c}.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Rec);
  const n = (w: string) => recs.filter((r) => r.chosen === w).length;
  const m = (f: (r: Rec) => number) => median(recs.map(f)).toFixed(0);
  console.log(
    `| ${c} | ${String(n('blank'))} : ${String(n('slime'))}${n('split') ? `, ${String(n('split'))} split` : ''} | ${m((r) => r.first)} | ${median(recs.map((r) => r.full)).toFixed(2)} | ${m((r) => r.byPart.blank.front)}; ${m((r) => r.byPart.slime.front)} | ${m((r) => r.byPart.blank.jones)}; ${m((r) => r.byPart.slime.jones)} | ${m((r) => r.byPart.blank.respawn)}; ${m((r) => r.byPart.slime.respawn)} |`,
  );
}
