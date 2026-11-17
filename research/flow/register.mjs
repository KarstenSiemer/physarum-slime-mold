// Usage: node --import ./research/flow/register.mjs research/flow/prototype/ring.ts
//
// Lets Node run the TypeScript files of this folder and of `src/`. The app imports its modules without a file
// extension, and some files use syntax that Node cannot strip (parameter properties). So every .ts file goes through
// the TypeScript compiler that `npm ci` installed: it removes the types and changes nothing else. The engine imports
// its shaders as text, with `?raw` after the name of the file, as Vite reads it: such an import is the text of the
// file here too, so that a script can run the engine on its CPU backend (research/electrode/fit.ts).
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

registerHooks({
  // A relative import without a file extension is the .ts file of that name.
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('?raw')) return nextResolve(specifier, context);
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // No .ts file of that name: Node resolves the import in its own way.
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('?raw')) {
      const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const out = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, verbatimModuleSyntax: false },
      fileName,
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  },
});
