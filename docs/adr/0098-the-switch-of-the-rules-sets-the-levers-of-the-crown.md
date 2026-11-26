# 0098: The switch of the rules sets the levers of the crown

- Status: accepted. The owner gave his feedback on 2026-11-26 (below). The coordinator reads it as the answer to open
  decision 4 of `TODO.md` (ADR 0097) and set decisions 2 and 3 on the same day. The choices of the code are an
  agent's. Both under the owner's delegation of 2026-11-12.
- Date: 2026-11-26
- Extends [ADR 0087](0087-the-crown-as-a-scene.md) (the levers of the crown in the panel)
  and [ADR 0097](0097-paid-births-thin-the-sheet-and-fill-the-dish.md) (its option 4: the owner first decides whether
  an agent is mass).

## Context

The owner wrote on 2026-11-26, in German, as points 1 and 3 of his feedback: "Wir wollen dichter an echte
Schleimpilze rankommen, ich habe zu wenig Wachstum beobachtet." and "Wachstumsfront soll sich wie echter Physarum
verhalten. So unterschiede wie 39:1 beim Y maze sind aber dann doch egal, 40:0 ist ok. Das aussehen ist das
wichtigste."

In English: "We want to come closer to real slime molds; I saw too little growth." and "The growth front should behave
like real Physarum. But differences such as 39:1 in the Y-maze do not matter; 40:0 is fine. The look is the most
important." His point 2, the veins in a darker colour of the prototype, is a task of its own.

A user who switches on Rules of the growth front in the panel keeps the levers of the flow of the scene. In most scenes
those are the defaults: 4 neighbours, a base conductance of 0.02 and a flux to the front of 1. The coordinator measured
both on 2026-11-26, on WebGPU, in Food ring, one seed (the runner `research/front/out/owner/veins.gpu.test.ts` in the
main checkout, git-ignored; the records `research/front/out/owner/veins/ring-rules/record.jsonl` and
`.../ring-crown/record.jsonl` there):

| Food ring with the rules     | Agents at step 8,000 | Cells with B·D > 0.05 at 8,000 | The look           |
| ---------------------------- | -------------------- | ------------------------------ | ------------------ |
| Levers of the scene (Flow 2) | 835                  | 180                            | a small round blob |
| Levers of the Crown of veins | 5,497                | 4,248                          | veins that fork    |

With the levers of the Crown of veins the colony had 3,091 agents at step 4,000, 10,065 at step 11,000 and 7,514 at
step 12,000. Its veins ran from the food to the rim and forked. The rise and the fall at the ring of foods is the boom
of study 1b (ADR 0092). This decision does not change it.

## Decisions

1. **An agent is not mass.** The coordinator reads the owner's words as the answer to open decision 4 of `TODO.md`:
   an agent stands for an area of plasm, and the rate of Mohberg and Rusch (one doubling in 8 hours) does not bind the
   growth. The owner wants more growth, and he puts the look first. Under the rate of the organism a young colony of
   study 1d held only 130 agents at step 20,000 (ADR 0097, finding 6).
2. **The switch on sets the levers of the crown.** When the user switches the rules on in the panel, the panel also
   sets Flow over 8 neighbours, a base conductance of 0.002 and a flux to the front of 2, and it raises the Flow
   strength to 8 if it is lower (`CROWN_LEVERS`, `crownLevers()` in `src/model/params.ts`; `setRules()` in
   `src/ui/state.svelte.ts`). The switch off changes none of them. No scene changes, and the format of a link does not
   change: a link stores the values it has, and a scene loads its own. So every scene keeps its bytes.
3. **The help says it.** The help of Rules of the growth front names the four levers and their values, and the
   numbers of Food ring above.

The agent's choices: the levers are a constant beside the help of the rules, and a test checks that they are the
levers of the Crown of veins, so that the scene and the switch cannot drift apart. The switch shows no notice: its
help names the levers, and the sliders show their new values.

## Consequences

- A user who switches the rules on in Food ring, the mazes or Tokyo gets a colony that grows and forms veins. The
  scene then counts as changed.
- Open: the three scenes of the Y-maze and Slime everywhere turn the rules on with their own levers (4 neighbours,
  0.02, 1). Whether they take the levers of the crown is open; it changes their bytes and their results of ADR 0088.
- Open: the boom at a ring of foods (ADR 0092) stays.
- Open decision 4 of `TODO.md` is answered. The ports that follow from it (ADR 0097, option 4: the rules of growth
  count area) are open.
