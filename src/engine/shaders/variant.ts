// Variants of a WGSL source by lines: the lines between `//#if NAME` and `//#endif` belong to the source only while
// NAME is on, and the lines after `//#else` only while it is off. The marker lines themselves never do.
//
// An override constant leaves its code in the source, and a binding that such code names is part of the pass even
// while the constant is false. Code that is cut out by lines leaves the source of the code before, character for
// character, so the pass without it compiles to what it was (ADR 0029: the flow in agents.wgsl).

/** `source` with the blocks of the names in `on` and without the others. */
export function variant(source: string, on: readonly string[] = []): string {
  const out: string[] = [];
  // The blocks that are open: whether each one keeps its lines now.
  const keep: boolean[] = [];
  for (const line of source.split('\n')) {
    const mark = /^\s*\/\/#(if|else|endif)\b\s*(\w*)/.exec(line);
    if (!mark) {
      if (keep.every(Boolean)) out.push(line);
      continue;
    }
    const [, word, name = ''] = mark;
    if (word === 'if') keep.push(on.includes(name));
    else if (keep.length === 0) throw new Error(`variant: ${line.trim()} without //#if`);
    else if (word === 'else') keep[keep.length - 1] = !keep[keep.length - 1];
    else keep.pop();
  }
  if (keep.length > 0) throw new Error('variant: //#if without //#endif');
  return out.join('\n');
}
