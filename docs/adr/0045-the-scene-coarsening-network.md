# 0045: The scene Coarsening network, measured against a paper's model and against the organism

- Status: accepted (decision of a helper, 2026-11-15, under the owner's delegation of 2026-11-12; the owner asked for
  the scene and the measurement), built 2026-11-15
- Date: 2026-11-15
- Extends ADR 0024 (scenes from later papers), ADR 0026 (the scenes of Jones on their lattices) and ADR 0037 (links to
  the figures of the papers).

## Context

`docs/fidelity.md` row 8 (network formation and minimisation) compared the app only with the figures of Jones 2010:
the docs held no number of the organism for it.

W. Baumgarten, J. Jones and M. J. B. Hauser, "Network coarsening dynamics in a plasmodial slime mould: modelling and
experiments", Acta Physica Polonica B 46(6): 1201–1218, 2015, doi:10.5506/APhysPolB.46.1201, measures the vein network
of _Physarum polycephalum_ while it coarsens, and runs Jones' model with stated values through the same measures. I
read the owner's copy, a proof whose pages are numbered 1001 to 1018, and compared its values with the text of the
journal's PDF: they are the same. Page numbers below are the journal's (the proof's plus 200).

The model of the paper (p. 1204 to 1206): a dish inside a lattice of 400 × 400 cells; 25,000 agents at random places
with random headings; SA = RA = 67.5°; SO varied (5 in Fig. 2 and 4; 3 to 15 in Fig. 5); a step of one cell; one agent
per cell; 5 units of trail per successful move; a blocked agent takes a random heading; a 3 × 3 mean times 0.9 in each
step; growth and shrinkage both every 5 steps; an agent that moved divides with 0 to 10 agents in its 9 × 9 window,
into a random empty cell of the 3 × 3 cells around it; an agent survives with 0 to 22 agents in its 5 × 5 window; the
agents update in random order. The paper gives no radius of the dish and no rule for its vein mask.

The licence: the journal offers the PDF free to read (`https://www.actaphys.uj.edu.pl/R/46/6/1201/pdf`, a fetch
without a login gave it on 2026-11-15). Neither the first page nor any other page of the PDF or of the proof states a licence.
So the app may link the figures and may not show them (ADR 0037).

## Options

1. No scene; only a script that runs the paper's values. The number for row 8 exists, but a reader cannot see it.
2. A Jones scene on the lattice of the paper, and a research script that measures it as the paper measures its model.
3. The same with the extended model and the flow. The flow could give veins of several widths, as the organism has.
   But then the app would not run the model of the paper, and its numbers would compare with nothing.

## Decision

Option 2. The choices below are mine.

1. **The scene** `coarsening`, "Coarsening network", in the group Experiments, on the Jones model and on the lattice
   of 400 × 400 cells on every screen (ADR 0026). Its settings are the values above. The app's choices where the paper
   is silent or the app differs:
   - the dish is the app's, 0.945 of the side (ADR 0027): 189 cells of radius;
   - density 25,000 / 160,000, because a dish counts the square around it (`sizing.ts`);
   - capacity 1: room for a child in every cell, since the paper has no limit. The population never came near it (at
     most 37,369 agents at SO 15);
   - Growth minimum 0, the paper's number. The app counts the agent itself (ADR 0025, decision 3), so 0 acts as 1;
   - sense first, the order of the paper's text (p. 1204 to 1205) and of every scene outside Jones 2010 (ADR 0027);
   - all agents update at once (ADR 0008), not in random order;
   - no glow, so the holes stay dark, as in the two network scenes.
2. **The link** (ADR 0037): Fig. 2 of the paper, page 7 of the journal's free PDF. Learn names the paper with its
   DOI. The scene card's source text is new (`sourceKind` `coarsening`).
3. **The measurement** lives in `research/coarsening/`, with an archive of its own (`logs.tar.gz`, 3 files, with a
   count and a digest in `research.test.ts`). Reason: the archive of `research/flow` belongs to ADR 0029, and parallel
   branches pack it; a second topic in it would conflict. The story, the definitions and all tables are in
   [`research/coarsening/README.md`](../../research/coarsening/README.md).
4. **The veins** come from the skeleton code that the Tokyo measures already use (`research/flow/prototype/tokyo.ts`),
   with a small step that cuts loose ends off (`veins()` in `measure.ts`).
5. **Seven sensor distances**, 3, 5, 7, 9, 11, 13 and 15, as in the paper's Fig. 5, in place of the four of the brief.
   Reason: the fit of the paper's law needs them, and all 21 runs take a few minutes.

## What came out

WebGPU, Apple M3 Pro, 2026-11-15, seeds 1 to 3, `main` at `b93584e` plus this branch. A second run of the campaign
gave the same file byte for byte. The vein mask is the trail above a quarter of a deposit; ρ is given for half a
deposit too, because the paper names no level.

| Measure                            | The app                          | The paper's model      | The organism (the paper) |
| ---------------------------------- | -------------------------------- | ---------------------- | ------------------------ |
| tc at SO 5, steps                  | 11,400 ± 2,066                   | 6,850 (one run)        | no steps                 |
| tc = γ / SO² + tc(0)               | γ 251,934, tc(0) 1,469           | γ 140,352, tc(0) 1,422 | none                     |
| app / paper at SO 3, 5, 7, 15      | 1.73, 1.62, 1.67, 1.10           |                        |                          |
| ρ at the start, level 0.5 / 0.25   | 0.73 / 0.92                      | about 0.7              | high, no number          |
| lowest ρ, level 0.5 / 0.25         | 0.14 to 0.15 / 0.21 to 0.22      | about 0.2              | about 0.2, and it stays  |
| ρ after tc                         | rises: the ring closes           | rises                  | does not rise            |
| veins over time (SO 7), per tmax   | two rates: 22.2, then 5.4        | two: 31.25, then 6.25  | one: 7.69                |
| β of length against number (SO 7)  | −0.38                            | −0.41                  | −0.35                    |
| junctions of degree 3 / 4 / higher | 99 % / 1 % / none                | mostly 3, up to 5      | 3                        |
| mean width of a vein over time     | constant (8.8 cells, level 0.25) | constant               | constant                 |
| widths of the veins                | one width (not measured)         | one width              | log-normal               |

- The app runs the course of the paper's model: mesh, coarsening, one ring, a spot, in 21 of 21 runs.
- The app coarsens more slowly: 1.6 to 1.7 times at SO 3 to 7, and the same at SO 15. The law and its offset are the
  paper's. The cause is not known. Move first in place of sense first is not it (tc 13,100 ± 819 at SO 5). The update
  of all agents at once is the likely cause; no run tests it.
- Against the organism the scene matches in three numbers: the lowest coverage near 0.2, the degree 3 and β. It does
  not match in the widths of the veins, in the one rate of the organism, and in the end: the plasmodium walks away,
  the model closes to a spot. The paper says the same about its model (p. 1216).

## Consequences

- `docs/fidelity.md` row 8 has numbers of the organism now, and the status "Partly".
- Every other scene keeps its bytes: no pass and no setting of another scene changed (digests of every scene on both
  backends after 500 steps, this branch against `main`).
- `presets.test.ts` pins the values of the paper and the page of the figure. Three tests that listed the scenes with
  growth or with the Jones model name the new scene.
- Open (`TODO.md`): why the app is slower; the distributions of lengths and widths; WebGL2; the extended model with
  the flow against the log-normal widths of the organism.
