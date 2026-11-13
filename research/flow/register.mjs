// Usage: node --import ./research/flow/register.mjs research/flow/prototype/ring.ts
//
// Lets Node run the TypeScript files of this folder and of `src/`. The app imports its modules without a file
// extension, and some files use syntax that Node cannot strip (parameter properties). So every .ts file goes through
// the TypeScript compiler that `npm ci` installed: it removes the types and changes nothing else.
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

registerHooks({
  // A relative import without a file extension is the .ts file of that name.
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const out = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: false },
      fileName,
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  },
});
