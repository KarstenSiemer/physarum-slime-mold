# 0031: One specification of the model, and one table against the organism

- Status: accepted
- Date: 2026-11-13
- Number: this record was merged as 0030 (pull request 49, 19:07 UTC). ADR 0030 about the flow of every strain was
  merged 17 minutes later with the same number (pull request 50), and 55 lines in 27 files cite it, among them code
  comments; the names of logs in `research/flow/logs.tar.gz` carry it too. This record had 3 citations, so it took
  the number 0031 (coordinator's choice under the owner's delegation of 2026-11-12).

## Context

On 2026-11-13 the owner asked whether the docs explain how and why the models behave as they do: the order of a step,
the mathematics, and how close the simulations come to the real slime mold, so that a reader can check them.

A review of the docs on `main` (`3935277`) found:

- The rules stand in several places: `docs/design.md` (section 3, mixed with buffers, atomics and the sort), the
  knowledge base, and ADRs 0007, 0008, 0019, 0020, 0022, 0025, 0027 and 0029. An ADR records a decision and its
  history. The rule in force often stands in a later amendment, and some older lines contradict the code (examples in
  Consequences).
- Most measurements compare the scenes of Jones with the figures of Jones 2010. That shows that the app is true to
  Jones' model. Only the Tokyo scene (Tero et al. 2010) and the time scales of the flow (Marbach et al. 2023) are
  compared with the organism, and the time scales were fitted.
- `docs/knowledge-base/biology.md` was last changed on 2026-11-09. It mentioned neither growth nor the flow, and it
  stated facts without a source.

## Options

1. Leave the docs as they are. Each fact can be found, but a check needs all files, and nothing shows the gap to the
   organism.
2. One specification of the rules in force, and one table of fidelity against the organism. Both name the ADR of each
   rule and number, and change in the same pull request as the code or the measurement.
3. Generate a specification from comments in the code. The code has no such comments, and a generated text cannot
   hold the reasons and the sources.

## Decision

Option 2, by the owner on 2026-11-13 ("Ja, schreiben"). The layout is the coordinator's choice under the owner's
delegation of 2026-11-12:

1. `docs/model.md` states the rules of the simulation in force: the state, one step in each order, the agents, the
   fields, growth, the flow and the tools, for both models and both backends, with the code and the tests of each rule.
   It holds no GPU details that change no result (buffers, tiles, the sort).
2. `docs/fidelity.md` lists each behaviour of the organism with its source, the model's mechanism, the measured number
   of the model with its source, and a status. A match with Jones' figures and a match with the organism have separate
   status words, and a fitted number is marked as fitted.
3. `docs/design.md` keeps the architecture and the GPU implementation, and points to `model.md` for the rules. A rule
   stands in one place only.
4. A unit test (`src/model/model-doc.test.ts`) fails when a parameter of the model is not in the table of parameters of
   `model.md`. This keeps the most likely drift visible.
5. The specification was built from four independent readings of the code on `main` (`e5e7710`), each with file and
   line, and checked against the code by a fifth reader.

## Consequences

- A pull request that changes a rule of the model changes `model.md`. A pull request with a new measurement against the
  organism changes `fidelity.md`.
- Older lines that contradict the code, found by the readers, are marked in their ADRs with a pointer to `model.md`:
  the source scale g and the plateau in ADR 0007 and ADR 0022 (true for the order that senses first only), the walls
  of ADR 0007 and ADR 0025 (superseded by ADR 0027), the first pass of ADR 0022 (the order that moves first adds its
  sources in the last pass), and a wrong decision number in ADR 0022.
- The differences between the flow docs and the flow code went to the session of ADR 0029, whose pull request #47
  changes those files.
- The table shows the gaps to the organism in one place. It does not close them. The open measurements and the
  missing sources (Nakagaki et al. 2000, a source on the avoidance of light) are listed in `fidelity.md`.
