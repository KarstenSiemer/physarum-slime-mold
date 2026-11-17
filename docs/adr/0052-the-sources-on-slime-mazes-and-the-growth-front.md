# 0052: The sources on slime, mazes and the growth front, and the plan of five stages

- Status: accepted (the owner asked for the work, agreed to the plan and made three decisions on 2026-11-16; the
  other choices are those of a helper, 2026-11-16, under the owner's delegation of 2026-11-12). Stage 0 of the plan is
  done with this record. Each later stage gets an ADR of its own.
- Date: 2026-11-16
- Extends [ADR 0030](0030-model-specification-and-fidelity.md): a new mark and two new rows in `docs/fidelity.md`.
- Extended by [ADR 0053](0053-no-child-onto-starved-ground.md) (2026-11-16): stage 1 of the plan, what it measured
  about the dead ends, and the texts of the app on the maze of 2000 (the first open point below).
- Extended by [ADR 0054](0054-a-starved-tube-leaves-starved-ground.md) (2026-11-17): stage 1b, which the owner added
  on 2026-11-16: the mark of starved ground that reaches the first aim of the plan.
- In short: the facts are in
  [`docs/knowledge-base/slime-mazes-and-the-front.md`](../knowledge-base/slime-mazes-and-the-front.md), and the plan
  is in `TODO.md`, "Slime, dead ends and the growth front".

## Context

ADR 0051 found that the dead ends of the two mazes with growth do not empty, and that nobody of this project had read
the maze paper of Nakagaki, Yamada and Tóth 2000.

On 2026-11-16 the owner asked for five things. The coordinator's notes of that day hold them, in English:

1. Get the paper of 2000 and more studies on the same topic. Then work on the branches that grow back into dead ends.
2. Show the slime that the plasmodium leaves between and behind the tubes; the plasmodium does not go over it again.
   The owner added that the slime "should also be perfused, basically" (the words of the notes). The notes call the
   meaning of this not clear. It is a question to the owner, and no stage of the plan builds it.
3. Handle several strains in one dish.
4. Show the ends of growth as the crown of a tree: the tube is the trunk, and the ends split in two again and again
   and get finer outward. The owner showed a photo: a dense centre, a few thick veins that thin and branch outward, a
   fine mesh between them, and about ten dense fans with a closed, scalloped rim, each on one trunk.
5. The mechanics of the tubes stay. The front is pushed forward visibly, and it leaves slime where tubes move.

Three research helpers read papers for it. The coordinator wrote their facts into notes, with what was read in full
and what only as an abstract. The notes and the PDFs lie in the owner's folder `papers/`, which git ignores.

## Decision

### The plan (the owner, 2026-11-16)

The owner agreed to a plan of five stages on the same day. One stage is one pull request with its ADR. `TODO.md` has
the text of each stage:

0. The sources: the facts of the notes go into the docs (this record).
1. The repair: a birth onto starved ground reads the cell of the child.
2. The slime field.
3. The picture of the front.
4. The front as a sink of the flow.

The rule of the tubes stays as it is (the owner's wish 5).

### Three decisions of the owner (2026-11-16)

Until now they stood only in `TODO.md`. The reasons are those that `TODO.md` gives.

1. **The crown is not only drawn.** The growth front gets a role in the flow (stage 4). Reason: plasm then flows in
   the crown, and a trunk forms from the rule of the tubes that the app has.
2. **The front is a sink only while it grows, and only a birth onto fresh ground counts**, which is ground without
   slime. Reason: a front that reached the end of a dead end then has no sink, its tube starves by the rule in force,
   and deaths and births in place keep no tube alive.
3. **One slime for all strains.** The line of the decision gives no reason. The text of stage 2 names a finding of
   Briard et al. 2020: no difference between ground of the own strain and of another.

### Stage 0 (a helper, under the owner's delegation of 2026-11-12)

- **One file for the facts.** `docs/knowledge-base/slime-mazes-and-the-front.md` holds every fact of the notes with
  its source, its page and how it was read, the equations and values of the models of a front, and what stages 2 to 4
  must read. `docs/knowledge-base/papers.md` lists the papers and their files in a second table. No paper, no text and
  no figure of a paper is in the repository, and the notes stay untracked.
- **The PDF wins.** The helper looked up each fact in its PDF, where one lies in `papers/`. Where the notes and the
  PDF differed, the docs have the value of the PDF; the last part of the new file lists the differences. Eight papers
  have no PDF there. Three open copies refused an automatic reader, so the docs keep the notes for them and say so.
- **A new mark, [A]**: only the abstract, or a figure with its legend, was read, not the body of the paper. Reason:
  several facts of the plan rest on abstracts, and those of the paper of 2000 on its free figure. [V], read in the
  full text, would say too much, and [S], the summary of a web search, too little. `docs/fidelity.md` and
  `docs/knowledge-base/flow-in-the-tubes.md` define it.
- **`docs/fidelity.md`**: the rows 2, 5, 6, 19 and 20 get the organism's facts. Two behaviours get a row: 23, the
  avoidance of its own slime (not modelled), and 24, veins that form a tree and follow Murray's law (not measured, and
  no tree toward a front). The facts on the front itself stay in row 6.

### The Maze follows the protocol of 2000; the grown mazes are another experiment

- The plasmodium of 2000 filled the whole maze before the food came. It was starved, and with the food nearly all of
  its protoplasm gathered on the two foods (Tero, Kobayashi and Nakagaki 2007, Sec. 1 and 3; Nakagaki et al. 2007,
  Phys. Rev. Lett. 99: 068104, p. 1). So it did not grow after the food came: it withdrew. This is this project's
  reading; no source uses these words.
- The scene Maze does the same, read in the code at `fc65ee3`. The preset `maze` (`src/model/presets.ts`, lines 752
  to 784) sets a density of 0.12, the flow and a random shrinkage, and neither a start layout nor growth (lines 768
  to 774). `settings()` (lines 171 to 173) fills in `defaultSettings()` (`src/model/params.ts`, line 568): the layout
  `mixed` (line 573), which spreads the agents evenly over the grid (`docs/model.md`, 10), and `growth: false` (line
  578). ADR 0029 says it in "The Maze (flux 8)": "the Maze has no growth" (lines 930 to 931, and line 1735).
- The Snail maze and the Corn maze start a colony on one food and grow it (`forager()`, lines 247 to 261, with the
  layout `food` and `growth: true`; ADR 0051). The paper of 2000 has no such phase, so it cannot say whether the
  organism grows back into a dead end. No other source of the docs says it either.
- The Maze differs from the experiment in two points: it has one route where the maze of 2000 has four, and its agents
  die in a dead end where the protoplasm of the organism moves to the foods.
- ADR 0051 says that nobody read the paper of 2000. Since this record its abstract and its Fig. 1 with the legend are
  read, and its body text is not. ADR 0051 stays as it was written.

## What the PDFs changed for the plan

- **Both models of a front make the front a sink of the flow.** The thesis of Schenz says it of the organism too: in
  nature the front takes the body mass and gives the flow its direction (Sec. 5.1, p. 68). This supports decision 1.
- **De Almeida 2021** gives every node of the boundary the same share of the flux. Two foods that both give all the
  time lose the links between them; foods that take turns keep them. On regular lattices his fronts showed the
  lattice. These are questions for the prototype of stage 4.
- **Murray's exponent of the organism**, 2.53 to 3.29, is the interval of a mean over 57 junctions of trees that
  drain an arena, not a range behind a front (Akita et al. 2017). By the relation of that paper the exponent 1.8 of
  the app's rule would give 2.2 at small flux. This is an inference; nobody measured it.
- **The curvature of 2.5 per mm**, a target of stage 3 in `TODO.md`, has no source that this project can name: the
  paper that the review gives for it does not hold the number.
- **The shortest route of the maze of 2000** was left alone in 5 of 19 runs, and the shorter of its first two ways
  was in all 17 networks. The counts were read from a picture by the coordinator; the helper did not see it.

## Consequences

- A fresh agent starts from the new knowledge-base file, not from the notes on the owner's machine.
- `docs/fidelity.md` has organism's numbers for the maze, the slime, the front and the tree of veins. It compares
  none of them with the app yet: stages 1 to 4 bring the measurements.
- The docs no longer say that nobody read the paper of 2000.
- No run changes, and no scene changes its bytes: the pull request changes docs only.

## Open points

- The texts of the app still say that the slime mold found the shortest way through the maze (`src/ui/Learn.svelte`,
  line 123; `src/model/presets.ts`, lines 760 and 1187). By Fig. 1d this holds for 5 of 19 runs. This pull request
  changes no file of `src/`.
- Not in the docs, and to read in a browser by a person: the sizes of the Y-maze and of the trap of Reid et al. 2012
  and the time of a trial, which stage 2 needs for its scene; the body text of the paper of 2000; the title of Briard
  et al. 2020.
- Nakagaki, Yamada and Tóth 2001 (Biophys. Chem. 92: 47) is the longer report of the maze experiment. Nobody read it.
- The owner's wish that the slime is "perfused" is not answered: its meaning is a question to the owner.
