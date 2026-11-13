import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSettings, strainSpec } from './params';

// docs/model.md states the rules of the model; its table of parameters must name every setting that changes a result
// (ADR 0030). The settings below change only the view or the playback.
const VIEW = new Set(['style', 'showScent', 'speed', 'exposure', 'bloom', 'strains']);

const doc = readFileSync(new URL('../../docs/model.md', import.meta.url), 'utf8');

function tableKeys(): string[] {
  const section = doc.split('\n## 11. Parameters')[1]?.split('\n## ')[0] ?? '';
  return [...section.matchAll(/^\| `(\w+)`/gm)].map((m) => m[1] ?? '');
}

describe('docs/model.md', () => {
  it('names every setting of the model in its table of parameters, and no other', () => {
    const settings = Object.keys(defaultSettings()).filter((k) => !VIEW.has(k));
    const expected = [...settings, ...Object.keys(strainSpec), 'attraction'].sort();
    expect(tableKeys().sort()).toEqual(expected);
  });
});
