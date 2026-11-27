# 0101: A checked cast to a class in the tests

- Status: accepted. An agent decided it on 2026-11-27 under the owner's delegation of 2026-11-12; the owner asked the
  same day to get the open updates merged.
- Date: 2026-11-27

## Context

The update of `typescript-eslint` from 8.72.2 to 8.74.0 (pull request #116) brings the rule
`@typescript-eslint/no-unsafe-class-instance-assignment` into the set `strictTypeChecked` that `eslint.config.js`
uses. The rule reports a value that the code uses as an instance of a class without a proof that the constructor of
the class made it. It reported 62 places, all in test files and research scripts: `engine.sim as CpuSim`,
`backend as WebGpuBackend`, `(await make(…)) as Simulation` and the like. Each is a cast from an interface (`Sim`,
`Backend`) to the class of one backend. A wrong cast does not fail at the cast. It fails later, with an error that does
not name the cause. `research/front/p100-ring.gpu.test.ts` held one cast that was wrong on purpose: it gave the WebGL2
backend the type of the WebGPU backend.

## Options

1. Turn the rule off for test files. No change of a test; the casts stay unchecked.
2. Replace each cast by a check at run time. One small helper; a wrong class fails at once and names the class.

## Decision

Option 2. `src/engine/instance.ts` holds `instance(value, Class)`: it returns the value with the type of the class, or
throws a `TypeError` with the name of the class. It takes a class with a private constructor too (`Simulation`,
`WebGpuBackend`). It follows `at()` of `src/engine/at.ts`, which does the same for an element of an array. The 62
places use it. The research script now branches on the class of the backend and no longer gives one backend the type
of the other.

The same update brings `prettier-plugin-svelte` 4.2.0, which formats seven files of `src/ui/` in a new way. The pull
request holds that new format. No scene changes: the change touches only tests, a research script and the format.

## Consequences

A test that needs the class of a backend writes `instance(sim, GlSim)`, not `sim as GlSim`. The rule stays on for all
code, so the app code cannot cast to a class without a check either.
