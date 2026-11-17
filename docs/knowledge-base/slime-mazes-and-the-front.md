# Slime, mazes and the growth front: what the papers say

Notes for the plan "Slime, dead ends and the growth front" of 2026-11-16 (`TODO.md`;
[ADR 0052](../adr/0052-the-sources-on-slime-mazes-and-the-growth-front.md)). The coordinator wrote the first notes on
that day, from three research helpers and from the code. A helper then looked up every fact in the PDFs that lie in the
owner's folder `papers/` (untracked), on the same day, and wrote this file. Where the notes and a PDF differed, this
file has the value of the PDF; its last part lists the differences. The papers are copyrighted: this file holds facts
and a few of their terms, no figures and no tables.

How a fact was read:

- **[V]** read in the full text. The helper found it in the PDF, and the line names the page or the section.
- **[A]** only the abstract, or a figure with its legend, was read, not the body of the paper.
- **notes**, after a mark: a research helper of the coordinator read it, the notes of 2026-11-16 hold it, and nobody
  checked it again. No PDF of such a paper lies in `papers/`. Three open copies refused an automatic reader on
  2026-11-16: a bot check at PubMed Central (Reid et al. 2012, Dussutour et al. 2010) and HTTP 403 at the Royal
  Society (Briard et al. 2020). On 2026-11-17 the coordinator read Reid et al. 2012 and Briard et al. 2020 in full
  in the copies of PubMed Central, so their lines have **[V]** alone now. Reid et al. 2013 stays **[A, notes]**: the
  page of its publisher answered HTTP 403.
- "cited there": the paper that was read says it of another paper, which nobody of this project read.
- **[I]** an inference or a conclusion of this project, not a fact of a paper.

Words. The papers call the layer outside the cell slime, mucus, slime sheath or slime coat, and what the plasmodium
leaves behind a slime trail, a slime track or a trail. This file says **slime** for all of them. The model has no
slime. Its memory of a tube is the **flow memory D**, and ground that a tube left by starving is **starved ground**
(`docs/model.md`, 8.4).

Pages. "p." is the number printed on the page. The copies from the repository of Hokkaido University (HUSCAP) have a
cover page, and some are manuscripts with page numbers of their own; where a copy prints none, the line says "PDF
page". The files and their free links: [papers.md](papers.md), second table.

## Mazes

### The maze experiment of 2000

T. Nakagaki, H. Yamada, Á. Tóth: "Maze-solving by an amoeboid organism", Nature 407: 470 (2000). The paper is behind
a paywall. Its abstract and Fig. 1 with its legend are free
([figure page](https://www.nature.com/articles/35035159/figures/1)). The coordinator read both, and the helper read
the legend again through an automatic reader. Nobody read the body text.

- The maze has four routes between its two foods. One part of the way is α1 (41 ± 1 mm) or α2 (33 ± 1 mm), another
  part is β1 (44 ± 1 mm) or β2 (45 ± 1 mm) (legend of Fig. 1) [A]. De Almeida 2021 (p. 8, caption of Fig. 2.3) gives
  the same four lengths, cited there [V]. So α2 is 8 mm shorter than α1, and β1 is 1 mm shorter than β2: as much as
  the error of one length [I]. The shortest route is α2 with β1.
- Four hours after the food was set, the dead ends of the plasmodium shrink, and pseudopodia explore every
  connection. Four hours later the shortest path is selected (legend, panels b and c) [A]. The plasmodium weighed
  90 ± 10 mg wet (legend) [A]; the notes do not have this number.
- Fig. 1d counts the paths of 19 runs. The page holds the counts only as a picture, a table with a row for each
  choice of α and a column for each choice of β. The coordinator read them from the picture, and the helper did not
  see it: α2 with β1, the shortest route, 5 runs; α2 with β2, 6; α2 with both β, 3; both α with both β, 3; and no
  tube in 2 runs. Every other cell of the table holds 0.
- The coordinator of stage 1 opened the figure page in a browser on 2026-11-16 and read the legend and the table of
  panel d again: the lengths, the times, the wet weight and the five counts are as written here.
- [I] So the shortest route alone was left in 5 of 19 runs. The shorter α2 was part of every network (17 of 17 runs
  with a tube), and in 14 of them without α1. β1 and β2 were left alone about equally often: 5 against 6. De Almeida
  2021 (p. 8) sums up the paper in the same way, cited there [V]: α2 was always selected, and β1 and β2 about the
  same number of times, because the bends of a tube hide a difference of 2 %.
- The walls were plastic film on the agar, a dry surface that the plasmodium avoids (de Almeida 2021, p. 8; Jones
  2015, arXiv:1511.05869, Sec. 5.3, PDF page 12; both cited there [V]).

### The protocol: the plasmodium filled the maze and then withdrew

- The plasmodium filled the maze at the start. Then the network of tubes appeared, the tubes in the dead ends
  degenerated, and the shortest path was left (Tero, Kobayashi and Nakagaki 2007, Sec. 3, p. 5, with Fig. 2) [V].
  Nakagaki is an author of both papers.
- The plasmodium was starved and spread over the whole agar. When food came, almost all of it gathered at the foods,
  and only a few tubes stayed between them (Tero et al. 2007, Sec. 1, p. 2) [V]. In a maze a starved organism forms a
  tube between the two foods while nearly all of its protoplasm gathers over them (Nakagaki, Iima, Ueda, Nishiura,
  Saigusa, Tero, Kobayashi and Showalter 2007, Phys. Rev. Lett. 99: 068104, p. 1) [V].
- A sample was left to fill the whole maze, and only then two blocks of agar with nutrients were put at its ends (de
  Almeida 2021, p. 8, cited there [V]).
- The legend of Fig. 1 of 2000 calls panel a the organism before it finds the path. It does not say in words that the
  plasmodium fills the maze [A].
- Reid et al. 2012 say it of the maze and of the networks between foods: the plasmodium first explores its whole
  space, with cytoplasm in all of it at the same time, and then takes the cytoplasm back from the parts without food
  (Discussion; they cite the papers of Nakagaki of 2000 to 2007) [V].
- [I] So the experiment has no growth after the food comes. The plasmodium covers every corridor first. What follows
  is a withdrawal: the mass moves to the two foods, the dead ends empty, and tubes stay. The sources do not use the
  words "did not grow"; this is this project's reading of the four lines above.

### The same maze again

D. Akita, D. Schenz, S. Kuroda, K. Sato, K. Ueda, T. Nakagaki: "Current reinforcement model reproduces
center-in-center vein trajectory of Physarum polycephalum", Dev. Growth Differ. 59: 465–470 (2017). The copy is the
version before peer review, with pages 1 to 12 [V].

- The authors built the maze of 2000 again and ran the experiment again (Sec. 2.1 and 2.2, p. 2 to 3; Fig. 1, p. 4).
- With turns at right angles α1 and α2 would be equally long. α2 is shorter because a tube cuts the corners. β1 is
  about 2 % shorter than β2 (Sec. 2.1, p. 3).
- One network lay on the shortest route, α2 with β1, 6 hours after the food came. Three others lay on other routes
  13 hours after it (Fig. 1c to f, p. 4). Which route stays depends on the bends of the tube, on the volume of the
  plasmodium and on the amount of food (Sec. 2.2, p. 3, cited there from Nakagaki et al. 2001 and 2007).
- A tube often formed along a longer route, not only along the shortest (Discussion, p. 8).
- Their model is the rule of Tero et al. on a fine random mesh that fills every corridor, with veins of one thickness
  at the start. It has no growth. The equations are in "Models of a front" below.

Two more models of this maze, both without growth:

- Tero et al. 2007 (Sec. 4, p. 9 to 12) [V]: the dead ends vanish first in every run, and then one route of each pair
  is chosen; `flow-in-the-tubes.md` has the rule and its three cases. The lengths of the routes in their graph are
  their own (15.425, 16.5, 18.164 and 19.0, p. 9), with α1 the shorter of its pair. They are not the lengths of the
  legend of 2000. The paper calls the evidence for its feedback, a tube gets thicker with more flux, only qualitative
  (abstract; Sec. 2, p. 3).
- De Almeida 2021 (Sec. 4.1, p. 43 to 44) [V]: the maze on a square lattice of 15 × 16 nodes with four routes of the
  same length, filled at the start, with one source and one sink. The dead ends vanish first. With equal start
  values all four routes stay; with random ones, one route stays, and the start values alone decide which.

### Dead ends

- A tube with an open end tends to disappear (Tero et al. 2007, Sec. 2, p. 3, cited there from Nakagaki et al. 2001)
  [V].
- An experiment with the organism: tubes in the shape of a T, with food at two of the three ends. The tubes of the
  third branch disappeared quickly (Tero et al. 2007, Sec. 5.1, p. 16, Fig. 11) [V].
- A dangling end of a vein vanishes or grows and is never stable. It grows where the pressure at it is high, and
  vanishes where the pressure is low (Marbach, Ziethen, Bastin, Bäuerle and Alim 2023, eLife 12: e78100, p. 11,
  "Dangling ends are unstable", Fig. 5A) [V].

### Tubes are built again within hours

T. Nakagaki, R. Kobayashi, Y. Nishiura, T. Ueda: "Obtaining multiple separate food sources: behavioural intelligence
in the Physarum plasmodium", Proc. R. Soc. B 271: 2305–2310 (2004). The copy is a manuscript without page
numbers [V].

- The plasmodium can take its tubes apart and build them again within a few hours when the conditions change
  (Introduction, PDF page 4).
- With plenty of food the plasmodium ends as two pieces, one on each food. Just before it splits, only the shortest
  connection is left (Introduction, PDF page 5, cited there from Nakagaki et al. 2001).
- The plasmodia of this paper were starved for 12 hours before the experiment (Methods, PDF page 6).

### What nobody found

No source of this file says whether a plasmodium grows back into the dead ends of a maze that it left. The helper
searched the text of every PDF of the second table of [papers.md](papers.md) for "dead end", "grow back", "regrow"
and "revisit" on 2026-11-16. The nearest facts are about open agar, not about a maze: the avoidance of slime, and the
growth over ground that the plasmodium left (Patino-Ramirez et al. 2019), both in "Slime" below.

T. Nakagaki, H. Yamada, Á. Tóth: "Path finding by tube morphogenesis in an amoeboid organism", Biophys. Chem. 92:
47–52 (2001) is the longer report of the maze experiment, as Tero et al. 2007 and Akita et al. 2017 cite it. Nobody
of this project read it.

### Fed and hungry plasmodia

- Fed plasmodia are sedentary and compact. On poor ground they migrate, sparse and wide (A. Dussutour, T. Latty,
  M. Beekman, S. J. Simpson: PNAS 107: 4607–4611 (2010); a research helper read paragraphs of it, and nobody checked
  them again).
- After a food the plasmodium waits and then searches again (T. Latty, M. Beekman: Behav. Ecol. 20: 1160–1167 (2009))
  [A, notes].
- The shape is compact and the exploration slow at high concentrations of nutrients or of salt. On ground that is poor
  in nutrients the plasmodium migrates fast and keeps main branches (Le Verge-Serandour and Alim 2023, Sec. 4.2.1,
  p. 13, cited there from four papers) [V].
- In 35 hours a plasmodium on plain agar left 5 % of its arena unexplored. With glucose in the agar it left 15 % and
  35 %, and with salt 38 % (Patino-Ramirez et al. 2019, p. 3) [V].

## Slime

### What it is

- Slime surrounds the whole plasmodium: a layer of mucopolysaccharides that the cell secretes. It is a large part of
  the volume of the plasmodium, and it stays as a trace where the plasmodium was (M. Le Verge-Serandour, K. Alim:
  "Physarum polycephalum: Smart network adaptation", arXiv:2306.09063, Sec. 2.2, p. 4, cited there) [V].
- The slime sheath is a thin, flexible coat outside the cell membrane. The plasmodium makes it while it grows and
  moves, and leaves it behind as a collapsed tube, the slime track (J. Clark, E. F. Haskins: "Myxomycete plasmodial
  biology: a review", Mycosphere 6: 643–658 (2015), p. 646) [V]; the helper read this passage only.
- The slime that stays behind is a thick layer, translucent and not alive (C. R. Reid, T. Latty, A. Dussutour,
  M. Beekman: PNAS 109: 17490–17494 (2012)) [V, notes]. The review describes it in the same way (Sec. 6.1, p. 19)
  [V].

### The plasmodium avoids its own slime

Reid et al. 2012 [V]. The coordinator read the full text on 2026-11-17, in the copy of PubMed Central (PMC3491460),
in the browser of the Claude app. The lines name the part of the paper; the copy prints no page numbers.

- **The Y-maze** (Results; Materials and Methods, "Avoidance response"; Fig. 2). Each arm is 4 cm long and made of
  1 % agar. A food of 10 % powdered oat in agar lies at the end of each arm. The base is a block of agar of 1 cm²
  with 3 cm² of search front on it; these are the numbers of the text. Not stated: the width of the arms, the angle
  between them, and the time of a trial.
- **The slime of the Y-maze**: a culture of the same stock migrated for 8 to 12 h across 1 % agar and left its
  slime there.
- **The score**: the arm whose food the plasmodium touches first is the chosen arm. A plasmodium that reaches both
  foods at the same time is a split and is left out. The arm with the slime changed sides between the runs.
- **The counts**: with slime on one arm, 39 of 40 plasmodia chose the blank arm (P < 0.001). With slime on both arms
  they showed no preference (n = 23, P = 0.93, one split). With two blank arms they showed no preference for a side
  (n = 40, P = 0.636). So slime is a choice, not a wall.
- The paper concludes from this that the plasmodium senses the slime upon contact.
- **The U-shaped trap** (Results; Materials and Methods, "Externalized spatial memory navigation task"; Fig. 3 and
  4). The dish is 8.6 cm wide and holds 1 % agar. The trap is a sheet of acetate on the agar: 5.2 cm at its base,
  with arms of 3.5 cm, in the centre of the dish. The plasmodium does not move over the dry sheet, and the glucose
  diffuses in the agar below it. The start: 1 mm² of search front. The goal: a well of 0.5 cm with 50 µL of 2 %
  glucose. A photo every 5 min, for 120 h at most.
- **The slime of the trap**: a plasmodium of 3 to 4 mm² explored a dish of 30 cm for 48 h; the disc of 8.6 cm was
  cut from this agar, without any plasmodium on it.
- **The counts of the trap**: 96 % of 24 plasmodia reached the goal within 120 h on blank agar, and 33 % of 24 on
  agar with slime. Those that arrived were faster on blank agar (n = 23 and 8). On slime a plasmodium stayed longer
  inside the trap, spent almost ten times as long on ground that it had explored before, and went a longer way. The
  mean speed did not differ (P = 0.345).
- **Without the trap** the slime changed neither the time to the glucose, nor the way, nor the speed (n = 13 and
  16). So a coat of slime does not mask the cue of the food.
- The paper gives no life time of the slime. [I] The slime of the trap was up to 48 h old at the start of a run of up
  to 120 h, and it still masked the plasmodium's own trail. So slime of 2 to 7 days still acts.

L. Tröger, F. Goirand, K. Alim: "Size-dependent self-avoidance enables superdiffusive migration in macroscopic
unicellulars", PNAS 121: e2312611121 (2024) [V]:

- Plasmodia on plain agar, followed for up to 134 h, usually do not cross their own path (p. 2 and 3).
- A plasmodium often turns away at a distance from the trail, not at contact. The authors suppose that a repellent
  of the slime diffuses in the agar (p. 3, Fig. 2A).
- Small plasmodia do not avoid. The 14 plasmodia had a median area of 0.65 mm². Four of the seven below it crossed
  their own trail one to seven times in about 90 h, and never sooner than 3 h after they laid it (p. 5). In tests
  with the trails of others, large plasmodia avoided the trails of small and of large ones, and small plasmodia
  avoided neither (p. 6).
- Their walk model forbids a step that comes nearer to the older path than twice the mean width of the plasmodium.
  For small plasmodia the rule ends 3 h after the trail was laid, and this fits the data. A penalty for a crossing in
  place of the rule did not fit (p. 6 and 7).
- Only 2.4 % of the runs longer than 28 min ended at a trail (p. 7).

More findings:

- Slime is a cue for "no food here". When the plasmodium perceives food, it enters ground with slime (C. R. Reid,
  M. Beekman, T. Latty, A. Dussutour: Behav. Ecol. 24: 812–818 (2013)) [A, notes]. Slime from a large culture made
  very large plasmodia (1 cm²) avoid it for up to 6 days (Tröger et al. 2024, p. 3, cited there from this paper) [V].
- L. Briard, C. Goujarde, C. Bousquet, A. Dussutour: "Stress signalling in acellular slime moulds and its detection
  by conspecifics", Phil. Trans. R. Soc. B 375: 20190470 (2020) [V]. The coordinator read the full text on
  2026-11-17, in the copy of PubMed Central (PMC7331006), without the supplement. The next six lines are from it.
- **What the plasmodia answered was not the slime.** A plasmodium explored a gel for 24 h. Then the gel was rinsed
  lightly with distilled water, to remove the slime, and cut up for the tests (Sec. 2b). So the cue is a substance
  that stays in the gel.
- **Two tests** (Sec. 2b and 2e). Patch: a plasmodium of 13 mm and two patches of 13 mm, 20 mm apart, in a dish of
  90 mm; the cue reaches the plasmodium by diffusion, and the patch that it reaches first is its choice. Bridge: a
  plasmodium of 10 mm between two strips of 40 mm × 10 mm that it touches; the strip on which it went farther after
  24 h is its choice.
- **Ground of a starved plasmodium is avoided, ground of a well-fed one attracts** (Sec. 3a, Fig. 2). Against blank
  agar, 88 % (patch, n = 50) and 74 % (bridge, n = 50) chose agar that a well-fed plasmodium had explored. Agar that
  a plasmodium had explored while it starved for 24 h was chosen by 16 % (patch, n = 62) and by 0.02 % as printed
  (bridge, n = 50). Between the two, 82 % (n = 50) and 96 % (n = 49) chose the ground of the well-fed one.
- A plasmodium that stayed joined to its food while it explored plain agar left a repellent too. The repellent was
  the stronger, the richer its food had been before: 10 %, 5 % or 2.5 % oat (Sec. 3a, Fig. 3).
- **On food there is no avoidance**: between oat gel that a plasmodium had explored and oat gel that none had, the
  plasmodia showed no preference (n = 50; Sec. 3b, Fig. 4). Ground of a clone mate that was stressed with caffeine
  or with light was avoided (Sec. 3b).
- **Three strains** were equally repelled by ground of stressed clone mates and of stressed plasmodia of another
  strain (Discussion; the data are in the supplement S9, not read). The paper names Dussutour et al. 2010 and Vogel
  et al. 2015 for the same finding, and Vogel et al. 2015 for the attractant of a well-fed plasmodium: calcium.
- **Against it**: on plain agar, and on agar with a little glucose, the growth over ground that the plasmodium had
  left was as frequent as chance gives it. The plasmodia did not avoid that ground (F. Patino-Ramirez, A. Boussard,
  C. Arson, A. Dussutour: "Substrate composition directs slime molds behavior", Sci. Rep. 9: 15444 (2019), p. 4)
  [V]. On agar with salt they grew over it more often than chance gives, and on agar with much glucose too, less
  strongly (p. 4). Over 35 h this second
  growth added up to 3.8 times the area of the arena on plain agar (p. 3 to 4).
- How that paper measures: 20 plasmodia per treatment, 2.5 cm wide, sitting on oat, in an arena of 14.5 cm, fed just
  before the start, a photo every 5 min (p. 10 and 11). "Mucus" is every pixel that the plasmodium left; such a pixel
  never counts as unexplored again (p. 11). So the paper measures where the plasmodium was, not the slime itself. On
  plain agar the first such ground showed after 5 h, and it covered 75 % of the arena at 35 h (p. 3).
- Slime is perhaps no repellent at all: plasmodia of _Physarum rigidum_ were seen to follow slime that was put on the
  medium (Masui et al. 2018, p. 2) [V].

### How long slime lasts

Nobody measured it. The docs hold three numbers, and none is a life time: small plasmodia cross their trail from 3 h
on (Tröger et al. 2024, p. 5); slime of a large culture repels for up to 6 days (Reid et al. 2013, cited in Tröger et
al. 2024, p. 3); and Patino-Ramirez et al. 2019 count left ground as "mucus" to the end of their 35 h, by definition.

### Several plasmodia

J. Clark, E. F. Haskins: "Plasmodial incompatibility in the myxomycetes: a review", Mycosphere 3: 131–141 (2012)
[V]:

- Two plasmodia of one species fuse only when they are alike, in phenotype, at about 16 loci: at least seven that
  control the fusion of the membranes, six for a fast lysis of the mixed part, and three for a slow lethal reaction
  that removes the nuclei of one side within 5 to 20 hours (abstract, p. 131).
- The counts of seven and six come from _Didymium iridis_ (p. 132 to 133 and 135). For _Physarum polycephalum_ the
  review reports four fusion loci (Collins and Haskins) and three lethal loci (Carlile), cited there (p. 133).
- Two plasmodia that do not fuse stay apart: they ignore each other, or one eliminates the other (p. 134).
- In a dish with several plasmodia, one is usually left after some time, most of all when they are of one species
  and do not fit. In paired tests with _Didymium iridis_ the loci mostly foretold the survivor (p. 136).

M. Masui, S. Satoh, K. Seto: "Allorecognition behavior of slime mold plasmodium: Physarum rigidum slime
sheath-mediated self-extension model", J. Phys. D: Appl. Phys. 51: 284001 (2018) [V]. The species is _Physarum
rigidum_, without food on the agar:

- Of the 10 pairs of five strains, one pair fused. The other nine avoided each other in all 100 encounters of 35
  experiments (p. 3). Pieces of one strain fused in the end in all 79 experiments (p. 4).
- In a part of the encounters the two stopped without touching, in many cases 0.1 to 1 mm apart, for 13 min to about
  7 h. Then they fused or turned away (p. 4). This happened in 32.4 % of the encounters that ended in avoidance and
  in 5.3 % of those that ended in fusion (Fig. 8, p. 5). In the other encounters the membranes touched first.
- At least 58.5 % of these 41 stops lay inside the slime of the other plasmodium, as far as the slime could be seen
  (p. 5).
- A pair that does not fit keeps avoiding each other until both weaken, after two or three days without food (p. 3).

### For the model: conclusions of this project

These lines are conclusions [I], not facts of a paper.

- **One slime for all strains.** Briard et al. 2020 found no difference between the ground of the own strain and of
  another, and Tröger et al. 2024 found that large plasmodia avoid the trails of other plasmodia too. The owner
  decided it on 2026-11-16 (ADR 0052). The finding of Briard et al. is about the substance that stays in rinsed
  ground, not about the slime (next line).
- **Two things stay on ground that a plasmodium left** (read on 2026-11-17). The first is the slime: the plasmodium
  avoids it upon contact, as a choice (Reid et al. 2012). The second is a substance in the ground that stays when
  the slime is rinsed off: a repellent after a starved or stressed plasmodium, and an attractant after a well-fed
  one (Briard et al. 2020). The experiment of Reid et al. does not take the two apart: their slime came from a
  culture that migrated over plain agar, and by Briard et al. such a plasmodium leaves the repellent too. In the
  model the mark of starved ground fits the second thing: ground that a starved tube left is closed for births, and
  a tube that was not starved leaves ground that the colony takes again at once (ADR 0054).
- **A bias, not a wall.** With slime on both arms of the Y-maze the plasmodium goes on, and through the U-shaped trap
  a third still arrives over slime. With fresh ground beside it, the choice is nearly strict: 39 of 40. A rule that
  lowers the weight of a slimed cell only while a fresh cell is free gives both. The walk model of Tröger et al. is
  for one small migrating plasmodium, not for a growing network: there a strict rule with an end after 3 h fitted,
  and a penalty did not.
- **Such a bias does not keep the colony out of a dead end** (measured in stage 1, ADR 0053, with the mark of
  starved ground in the place of the slime). Inside a dead end that the colony left, every free cell has slime, so
  the bias never acts there, and the colony comes back as before. What kept the dead ends empty in that measurement
  was ground that stays closed for births for a fixed time. Since ADR 0054 the mark of starved ground is such ground:
  a starved tube that vanishes leaves the lowest flow memory, and no child is born there for 3.7 days of model time.
- **Food lifts it.** Reid et al. 2013 (abstract) and Briard et al. 2020 say so: on oat gel the plasmodia of Briard
  et al. chose explored and unexplored ground alike. The state of the plasmodium matters as well: ground of a
  well-fed plasmodium attracts, and the fed plasmodia of Patino-Ramirez et al. 2019 did not avoid left ground at
  all. Food that lies 4 cm away does not lift it: the Y-maze of Reid et al. 2012 had a food at the end of each arm.
- **The same speed on slime.** On agar with slime everywhere the plasmodia of Reid et al. 2012 moved as fast as on
  blank agar. So a rule that slows the growth on slime where no fresh ground is near does not follow the organism.
- **The reach is short.** The organism senses slime at contact (Reid et al. 2012) or from a short distance (Tröger et
  al. 2024; Masui et al. 2018: 0.1 to 1 mm). A cell of the Tokyo scene is 0.54 mm. So a rule that reads the slime of
  the cell of the child reads at the organism's distance.
- **No life time to take from a paper**: 3 h to 6 days are reported, and the slime of the trap of Reid et al. 2012
  still acted at an age of 2 to 7 days. In the model, starved ground is fresh again
  after 6 days, the longest of these times, and it is open for births again after 3.7 days (`docs/model.md`, 8.4 and
  8.6; ADR 0054). Before ADR 0054 the times were 18 h and 11 h at most, and half of the closed ground of a dead end
  was open again within about 7,000 steps, 4 h (ADR 0053). A mark that fades lets the colony come back when it has
  faded: measured once, 160,182 steps after the ground closed (ADR 0054).
- **No answer for the dead ends.** No paper says whether the organism grows back into a dead end. The maze of 2000
  had no growth after the food came, so the growth of the Snail maze and the Corn maze has no experiment to follow.

## The front

### A sheet first, then channels, then tubes

Le Verge-Serandour and Alim 2023 (arXiv:2306.09063; a review, later in Annu. Rev. Condens. Matter Phys. 15, as
Tröger et al. 2024 cite it) [V]:

- A growing front is called a fan. It is a thin sheet of protoplasm that swells and shrinks with the contractions of
  the network behind it, as the flow is pushed into it. Some fans are pulled back; others stay and form channels,
  which become tubes (Sec. 2.2, p. 4).
- A front is first a wide sheet without visible structure. As it moves on, veins appear in it and form a network.
  The veins along the direction of the flow get stronger, and the others disappear (Sec. 4.1, p. 12).
- First channels appear in the sheet of the front. Then the tubes get clear outlines, and the thin layer between
  them thins away (Sec. 5.1, p. 15).

### Times and lengths behind the front

D. T. Schenz: "Transportation Network Optimisation during Exploratory Migration in Physarum polycephalum", doctoral
thesis, Hokkaido University, March 2019 [V]. The notes and `TODO.md` call it Schenz 2018, after the name of the file.
Its experiments are those of Schenz, Shima, Kuroda, Nakagaki and Ueda 2017 (J. Phys. D 50: 434001), which nobody of
this project read.

- The experiment: pieces of a growth front of 20 ± 2 mg in lanes 5 mm wide with bends, on agar without food, 15 runs
  in a U-shaped lane and 8 in a snake-shaped one, a photo every 3 min (Sec. 3.1.1, p. 24 to 26).
- The main vein appears at a spot about 50 min after the front passed it. In almost all runs it keeps its place from
  then on, also after the whole lane is explored and after food is added (Sec. 3.1.3, p. 30, Fig. 3.5). The
  plasmodium took 15 ± 4 h for the whole lane (p. 30).
- Just behind the front there are many veins side by side. Farther back they join to a few and then to one main vein;
  small side veins disappear slowly (Sec. 3.1.4, p. 30; Sec. 4.2.2, p. 61).
- The absorbance of a spot falls as the front moves away, with a time scale of 195 s: the mass of the sheet goes into
  the veins (Sec. 4.1.3, p. 52, Fig. 4.5). The thesis calls this about ten times slower than the advance of the
  front.
- A front that is cut off keeps extending for at least 10 min at nearly the same rate, although the contractions stop
  at once. It gets thinner and stops about 20 min after the cut. So the front needs supply from the rear only over a
  longer time (Sec. 2.2.3, p. 20, cited there from Takagi et al. 2007 and Ueda et al. 2011).
- In the lane the main vein cuts each corner and comes back to the middle of the lane after it. It is 4.6 % longer
  than the shortest path, and the middle line is 18.5 % longer (Sec. 3.1.3 and 3.1.4, p. 26 to 31; the caption of
  Fig. 3.4 says 6 % and 18 %).
- The thesis gives no speed of the front and no width of a zone in mm. It prints the area of the arena as 35 mm²,
  which cannot be right for a lane 5 mm wide, so the docs take no speed from it.

### Thickness and speed

S. Kuroda, S. Takagi, T. Nakagaki, T. Ueda: "Allometry in Physarum plasmodium during free locomotion: size versus
shape, speed and rhythm", J. Exp. Biol. 218: 3729–3738 (2015) [V]. 54 plasmodia from 100 µm to 10 cm on plain agar,
the larger ones in lanes 1 to 8 mm wide (abstract; p. 3730).

- The plasmodium is thickest close to the front, and its thickness falls exponentially toward the rear (abstract;
  p. 3732). The decay distance is 2.6, 6.9 and 11.6 mm for a small, a medium and a large plasmodium (Fig. 5A,
  p. 3733). Almost all protoplasm is in the frontal part (p. 3732).
- The speed grows with the largest thickness: v = 0.17 · h^0.94, with v in mm per min and h in mm (Fig. 6, p. 3733).
  [I] At a thickness of 1 mm this is 0.17 mm per min, about 1 cm per hour.
- Small plasmodia have the shape of a tadpole. Larger ones have more than one front, and still larger ones a fan with
  a sheet at its edge (p. 3730).
- A front of a plasmodium of medium size sometimes splits in two, shortly after it slowed down. After each split one
  of the two fronts stopped and was gone by the time of the next split (p. 3736, Fig. 9). Speed, shape and period
  swing with a long period of 20 ± 10 min (abstract).

The review gives 2 to 3 cm per hour as the speed that a plasmodium reaches (Sec. 4.1, p. 10, cited there) [V].

### When a front splits

Above a size of about 1 mm a plasmodium has several fronts. They appear below a critical curvature of 2.5 per mm (Le
Verge-Serandour and Alim 2023, Sec. 4.1, p. 12, cited there) [V]. The first sentence has Rodiek, Takagi, Ueda and
Hauser 2015 as its reference, which nobody of this project read. The sentence with the number ends with a reference
to Baumgarten, Jones and Hauser 2015. The proof of that paper lies in `papers/`, and it holds neither the number nor
the word curvature. So the docs do not know where the number comes from. [I] A circle with a curvature of 2.5 per mm
has a radius of 0.4 mm, which fits the size of about 1 mm.

### The network behind the front

- The network is a planar graph whose nodes join three tubes. The radii of the tubes are log-normal with a mean of
  50 µm (Le Verge-Serandour and Alim 2023, Sec. 5.1, p. 15, cited there from Baumgarten, Ueda and Hauser 2010 and
  from Fricker et al. 2017) [V]. Baumgarten, Jones and Hauser 2015 has the three veins and the log-normal widths
  too, and the coverage that falls to about 0.2 (`docs/fidelity.md`, row 8) [V].
- The radius of a vein follows the shear rate of its flow with a delay of about 2 min, and it adapts within 10 to 100
  min (Marbach et al. 2023, p. 6 and 8) [V]. `flow-in-the-tubes.md` has more of this paper.

D. Akita, I. Kunita, M. D. Fricker, S. Kuroda, K. Sato, T. Nakagaki: "Experimental models for Murray's law", J. Phys.
D: Appl. Phys. 50: 024001 (2017). The copy is the manuscript, with pages 1 to 11 [V]. **The networks of this paper
do not lie behind a front.** They form while a plasmodium leaves an arena through one exit:

- A sheet of protoplasm fills a small arena (a circle of 10 mm, five rectangles, one irregular shape), and food lies
  at the one exit. Veins show within a few hours and keep their layout while the plasmodium leaves (Sec. II.A and
  III.A, p. 2 to 3; Fig. 1 shows them from 2 hours on).
- The veins get thicker toward the exit, and they reach the arena as a tree that forks again and again (abstract).
- The thickness between the veins falls exponentially, at nearly the same rate everywhere: with a time constant of 6
  to 7 h in the circle, about 8 h in the rectangles and 15 h in the irregular shape (Sec. III.B, p. 3 to 4).
- No point of the arena is far from a vein: the largest distance is 0.1 to 0.2 of the largest distance inside the
  arena (Sec. III.C, p. 4).
- At 57 junctions of three veins in the circles the authors solve r0^n = r1^n + r2^n for n, with r0 the widest vein.
  The median of n is 3.15. The range 2.53 to 3.29 is the interval of the mean after a transform (arctan n = 1.235 ±
  0.045), not the spread of the junctions: the values of single junctions spread widely (Sec. III.E, p. 5, Fig. 6).
  The text calls ± 0.045 a confidence interval of 95 %, and the caption of Fig. 6 a standard deviation.
- Murray's law is n = 3. Then the shear stress at the wall is the same in every vein, and the mean speed of the flow
  grows with the radius (Sec. V, p. 9).

### The medium and the shape

- On a rich medium the plasmodium grows as a mesh with a sheet at the front. Under starvation or with repellents it
  grows as trees of branches (A. Takamatsu, E. Takaba, G. Takizawa: J. Theor. Biol. 256: 29–44 (2009)) [A, notes].
- Jones describes the growth front of the organism as a fine mesh, almost uniform, that gets coarser toward the
  origin, and says that the patterns differ with the nutrients and the substrate (Jones 2011, Nat. Comput. 10:
  1345–1369, p. 1346, cited there from Adamatzky et al. 2008 and Takamatsu et al. 2009) [V].
- The paper of Jones has no fan and no trunk: neither word occurs in it [V, a search of the text]. Its growth rule
  is the one of this app (ADR 0025).

### What nobody found

No source of this file gives the widths of the zones behind a front (the sheet, the fine channels, the veins) in mm.
The nearest numbers are the decay distance of the thickness (2.6 to 11.6 mm, Kuroda et al. 2015), the 195 s in which
a spot gives its mass to the veins, and the 50 min until the main vein shows (Schenz 2019).

## Models of a front

### 1. The front takes flux: de Almeida 2021

R. F. F. de Almeida: "Formation and Optimisation of Vein Networks in Physarum", MSc thesis (supervisor R. Dilão),
July 2021, arXiv:2305.12244 [V]. Chapter 5 (p. 59 to 67) has the growth; it uses the rule of chapter 3.

**The rule of chapter 3 is not the rule of Tero et al.** The thesis shows that Tero's rule does not keep the volume
of the network (p. 18 to 19, Fig. 3.1) and takes another one:

- Nodes i with a pressure p_i, edges with a length L and a conductivity D = π r⁴ / 8η. The flux of an edge is
  Q = D (p_i − p_j) / L. A node has a net flux q_i, above 0 for a source and below 0 for a sink, and the q_i add up
  to 0 (Eq. 3.13 and 3.14, p. 20). The pressures solve a linear system with the weighted Laplacian of D / L (Eq.
  3.37 to 3.39, p. 26 to 27).
- The volume of the network is V = β Σ L √D (Eq. 3.11, p. 18); every run sets β = 1.
- The rule (Eq. 3.19, p. 21): d√D/dτ = (V / β) · g(Q) / Z − √D, with Z = Σ L g(Q) over all edges. It keeps V for any
  g. Z couples every edge to every other, so the rule is not local.
- g(Q) = |Q|^γ (Eq. 3.45, p. 37). γ = 2/3 gives the least dissipated power at a fixed volume (Eq. 3.21 to 3.34, p. 22
  to 25). In its steady state √D grows with Q^(2/3), so D with Q^(4/3) and Q with r³ [I, the last step]: Murray's
  law, and the exponent 4/3 of Akita et al. below.
- Below γ = 1/2 the networks keep many loops and veins of one size. Above it they are trees without loops, with a
  clear order of thick and thin veins (Sec. 3.6.4, p. 37 to 38).
- One explicit Euler step of Eq. 3.19 per time step Δτ (Eq. 3.40, p. 28). With another Δτ some runs ended in another
  network (p. 28).
- The mesh is a Delaunay triangulation of a square lattice whose points are moved at random (Sec. 3.5.4, p. 28 to 29).

**The growth** (Sec. 5.1, p. 59 to 61):

- An edge of the mesh is active (a vein) or inactive. A node is empty, growing or transport. A growing node is an
  active node with at least one inactive node beside it: a node of the boundary.
- The active food gives I0. Every boundary node is a sink, and all of them take the same share (p. 61). So a sink
  gets less as the boundary gets longer.
- A boundary node stores what it takes: m_i grows by |q_i| Δτ (Eq. 5.1, p. 61). It gives its store in equal parts to
  its inactive edges. An inactive edge has a cost in proportion to the first volume of its vein, √D0 · L. When the
  cost is paid, the edge is active with D = D0, and its far node becomes a boundary node.
- A boundary node without an inactive node beside it becomes a transport node and gives its store to its growing
  neighbours.
- The veins adapt by Eq. 3.19, and V grows with each new vein.
- Values (Fig. 5.1, p. 62): I0 = 0.1, γ = 2/3, D0 = 0.1, Δτ = 0.02, a mesh from a lattice of 35 × 35 points.

**Results** (Sec. 5.2, p. 62 to 67):

- One food: the network is a tree with fan-shaped fronts, and it forks more densely away from the food. No link
  across the main veins stays. With γ = 0.45 the network keeps nearly the whole mesh and has no order of thick and
  thin veins. Shares of the sinks drawn at random change nothing (p. 62 to 64).
- The growth gets slower with time, because the boundary gets longer (p. 62).
- **On regular lattices** (square, triangular, hexagonal), also with a little noise on the nodes, the fronts were not
  round: the lattice stayed visible (p. 63).
- **Two foods that both give all the time push each other away**: the short links between them get weak and
  collapse. When only one of the two gives in each step, drawn at random, a short link between them forms and stays
  (Sec. 5.2.2, p. 64 to 66). The thesis reads the second case as nearer to the flow that goes back and forth.
- Open in the thesis itself: the time scales of growth against adaptation, and sinks inside the body (p. 66 to 67).
- Chapter 5 has no walls, no dead ends and no slime, and the body of its model does not move (p. 59).

### The same rule with all cells as sources: Akita et al. 2017 (Murray's law)

The model of the paper above (Sec. IV.A and IV.B, p. 5 to 6) [V]:

- Tero's rule on a random mesh: Q = D ΔP / L (Eq. 4), D = π r⁴ / 8ν, dD/dt = f(|Q|) − D (Eq. 5), f(Q) = |Q|^μ.
- In the steady state D = |Q|^μ and D grows with r⁴, so Q grows with r^(4/μ), and at a junction
  r0^(4/μ) = r1^(4/μ) + r2^(4/μ) (Eq. 6 and 7). So n = 4/μ, and Murray's law is μ = 4/3.
- The run: 10 µm per pixel, a Delaunay mesh with one node per 500 pixels, the node at the exit as the one sink, and
  every other node a source of 0.1. Every radius starts at 0.1. Time steps of 0.001, 0.01 and 0.1 up to t = 50.
- μ = 4/2 and 4/3 give a tree from the exit that gets thinner toward the edge, as in the experiment. μ = 1 gives a
  tree with loops, and μ = 4/5 many loops and veins of one size (Fig. 7, p. 6 to 7).
- μ = 4/3 gives the smallest volume and the smallest product of friction and volume (Sec. IV.C, p. 7 to 8).
- The run does not model the sheet that gets thinner: every source keeps its 0.1 (p. 6 and 10).
- How a network forms in an even sheet is less clear to the authors. They name the idea of Guy et al. 2011: a flow
  through the gel that is fast enough opens a channel (Sec. V, p. 9, cited there).

The maze paper of Akita et al. 2017 (Sec. 3, p. 6 to 7; Fig. 2, p. 5) [V] uses the same rule between the two foods of
the maze of 2000, with a source and a sink of 1. With f = |Q|^1.33 one vein stays; it cuts the corners, and it is not
always the shortest. With f = (1 + a)|Q|^μ / (1 + a|Q|^μ) one vein stays for (μ, a) = (1.5, 0.5) and (3, 6), and
several for (1.5, 10) and (3, 1000). With μ = 1 the shortest path wins, but slowly where routes are nearly equal
(p. 8).

### 2. A field of the front, the tubes and waves: Schenz and Ueda

Chapter 4 of the thesis of Schenz (p. 41 to 57; its model is that of Schenz et al. 2017) [V]. The notes called it a
field of the front with two more fields. It has three parts, and all three are needed:

- **The front** (Eq. 4.1a to c, p. 43; the one-dimensional form is Eq. 2.9, p. 20): a regulation factor u, a solation
  factor v and the thickness w. τ2 ∂u/∂t = D_u ∇²u − u v²; τ2 ∂v/∂t = D_v ∇²v + u v² − α1 v; τ2 dw/dt = α2 v. v makes
  itself from u and spreads, so a pulse of v runs into ground where u is still high. u is high everywhere at the
  start, also outside the body, which the thesis calls not realistic (p. 42).
- **The tubes** (Eq. 4.2a to c, p. 44): a fixed fine mesh. An edge has a flow q with inertia, and a node a pressure
  p that the flows fill: dq/dt = ((p_i − p_j) − R q) / I, dp_j/dt = Σ q / C. I, R and C depend on D = d⁴, with d the
  radius, and stay finite at D = 0. dD/dt = |q|^μ / (1 + a_d |q|^μ) − r D.
- **The waves** (Eq. 4.3, p. 45; Eq. 4.8, p. 49): calcium c and a phosphorylation φ form an oscillator. It runs three
  times as fast in the start region, so waves start there and run to the front.
- **Four links** (Sec. 4.1.2, p. 46 to 47): (1) the tubes bring v to the front: v gains k · B(w) · D̃, with D̃ the sum
  of D of the tubes at a node and B = 1 only in the band of thickness of the front (Eq. 4.4 and 4.5). (2), (3) The
  pressure falls where calcium is high, and a node holds more where v is high: dp_j/dt = Σ q / (C (1 + a_v v)) −
  κ (c_j − c̄) (Eq. 4.6). So the front, where v is high, is a sink of the flow. (4) A tube grows only inside the
  body: the gain of D counts only where w is above a threshold (Eq. 4.7).
- Values (Table 4.1, p. 52): D_u = 0.2, D_v = 0.02, α1 = 0.01, α2 = 0.1, k = 0.01, μ = 1.3, a_d = 0.01, r = 0.15,
  κ = 1.0, a_v = 0.01, τ2 = 20, τ̄1 = 0.0072, the thresholds of w 0.1, 0.9 and 1.0. Start: u = 3 everywhere, v = 1
  and c = 1 in the start region, D = 0.1 on its edges and 0 elsewhere (p. 49). The table has the constants of the
  oscillator and of I, R and C too.
- The time scales are set so that about 600 waves pass until the lane is covered (p. 47).
- Results: main veins form a short way behind the front and keep their place; the vein cuts the corners as in the
  experiment (Sec. 4.1.3, p. 49 to 53). With k = 0 the vein lies nearer the shortest path (p. 54 to 55). With a much
  faster front the veins form far behind it, and the vein follows the inner wall (p. 55 to 57).
- **The thesis names the front as the sink.** In nature it is the front, with its change from sol to gel, that takes
  the body mass and gives the flow its direction; foods do this only in the experiments that start with a covered
  arena (abstract, p. vi to vii; Sec. 5.1, p. 68).

**The simple algorithm of the same thesis** (Sec. 4.2, p. 58 to 65) needs only the history of the front:

- Take the outline of the front at fixed intervals. Join each point of a later outline with the nearest point of the
  outline before it. Keep only the chain of such links that leads from the last outline to the first (p. 58 to 61).
- The predicted vein lies less than half as far from the real main vein as the shortest path does (Fig. 4.11, p. 63),
  in 8 runs of the snake-shaped lane. It also gives the many veins just behind the front that join farther back
  (p. 61).
- Intervals of about 15 min gave the best median, but no interval up to 30 min was the best for every run; the
  figures use 9 min (p. 61 and 65).

### 3. Channels that the flow opens in a sponge

R. D. Guy, T. Nakagaki, G. B. Wright: "Flow-induced channel formation in the cytoplasm of motile cells", Phys. Rev.
E 84: 016310 (2011) [A, notes]. Not checked. Akita et al. 2017 describe its idea (above).

### For the model: conclusions of this project

These lines are conclusions [I], not facts of a paper.

- **Both models make the front a sink.** They differ in what drives the flow: a food with a fixed flux (de Almeida),
  or pressure waves from the rear (Schenz and Ueda). The app has Tero's rule with fixed fluxes at the foods, so the
  first way is the short one: keep the rule of the tubes and add sinks where the colony grows. De Almeida himself
  does not keep Tero's rule; his rule needs a sum over the whole network in every step.
- **The share of a sink.** De Almeida gives every boundary node the same share. The owner's decision of 2026-11-16
  ties the sink to births onto fresh ground (`TODO.md`). No paper tests that.
- **Foods that give all the time lose their links** in de Almeida's model; foods that take turns keep them. The app
  draws the roles of its foods again every 300 steps (`docs/model.md`, 8.2). Whether the links between the foods of
  Tokyo stay with sinks at the front is a question for the prototype of stage 4.
- **The lattice.** De Almeida saw the lattice in the shape of the front on regular lattices. The app runs on square
  cells. Its front is placed by the growth rule of Jones, not by the sinks, so this may not carry over; the prototype
  should look at it.
- **Murray's exponent of the app.** By n = 4/μ, Murray's law needs μ = 4/3. The app has f(Q) = Q^1.8 / (1 + Q^1.8)
  (`docs/model.md`, 8.4). Where the flux is small this is μ = 1.8, so n = 2.2, below the 2.53 to 3.29 of the
  organism; where f is near 1, all tubes get the same D and no exponent holds. Nobody measured it, and the radius of
  a tube is only drawn (ADR 0034).
- **What to compare.** The exponent of Akita et al. is the mean over 57 junctions of trees that drain an arena. A
  measure in the app should take the mean and the median over many junctions, not single values.

## For the stages of the plan

**Stage 2 (the slime field).** Read "Slime" above. Since 2026-11-17 it has the sizes of the Y-maze and of the trap
of Reid et al. 2012 and how a choice was scored. The width of the arms of the Y-maze and the time of a trial are
not in the paper.

**Stage 3 (the picture of the front).** The zones and their sources are in "The front": the sheet, channels and
tubes (the review, Sec. 2.2, 4.1 and 5.1); the 50 min of the main vein (the thesis of Schenz, Sec. 3.1.3, p. 30); the
195 s of the sheet (p. 52); the decay distance of the thickness (Kuroda et al. 2015, Fig. 5A). An idea of this
project [I]: a field with the step at which the front reached each cell gives the age of a cell, and the zones follow
the age: the sheet, the fine channels, the veins, and the trace of slime where the colony left. The 50 min of the
main vein, 1,500 steps, set where the zone of the veins starts. The algorithm of Schenz needs only such a field: his
main vein follows, from the newest front backward, the nearest point of the front before.

**Stage 4 (the front as a sink).** Read first, in this order:

1. De Almeida 2021, chapter 5 (p. 59 to 67), with Eq. 3.13, 3.14 and 3.19 (p. 20 to 21) and Sec. 3.6.4 (p. 37 to 38).
2. Akita et al. 2017, "Experimental models for Murray's law": Sec. III.E (p. 5) for the measure and Sec. IV.A and
   IV.B (p. 5 to 6) for the model.
3. Akita et al. 2017, the maze paper: Sec. 3 (p. 6 to 7) and the Discussion (p. 8).
4. The thesis of Schenz: Sec. 3.1.3 (p. 26 to 30), Sec. 4.1.1 and 4.1.2 (p. 42 to 49), Table 4.1 (p. 52) and Sec. 4.2
   (p. 58 to 65).

## Read in the code, and what stage 1 measured

Read by the coordinator on 2026-11-16:

- The rule "an agent does not divide on a cell with D < 0.01" read the cell of the parent (`divideInto()` in
  `growth.wgsl`). A parent on a living tube beside starved ground still placed a child there. The rule of light reads
  the cell of the child (ADR 0050). **Measured in stage 1** (ADR 0053): this was a third of the births in the dead
  ends of the Snail maze. Since ADR 0053 no child is born onto a starved cell, and the test of the cell of the parent
  stays.
- **That was not the cause of the growth back into dead ends** (ADR 0053). The cause was the mark of starved ground:
  a cell is closed for births while D < 0.01, D fell only while the cell held a tube, and a starved tube is gone soon.
  So the ground of a dead end opened again after some thousand steps, and the colony came back as a wave. ADR 0054
  changed the mark on 2026-11-17: a starved tube that vanishes leaves its ground at the lowest flow memory, and the
  mark lasts 6 days. With it the dead ends of the Snail maze stay empty until the mark has faded. `TODO.md` has what
  follows for stages 2 to 4.
- Flux exists only between food sites with a role (`docs/model.md`, 8.4 and 8.5). A tube that leads only to a growing
  front carries no flux, so no trunk can form toward a front. Not measured.

## Where the PDFs differ from the notes of 2026-11-16

The notes stay on the owner's machine (`papers/notes-2026-11-16-slime-and-front.md`). These lines of them are
replaced by the text above:

- **Jones 2011.** The notes read "a fine uniform mesh front" as the result of Jones' growth rule. The paper says it
  of the growth front of the organism (p. 1346).
- **De Almeida 2021.** The notes say that the conductance goes with the flux to the power 2/3, and that the model
  keeps Tero's rule. In the thesis the square root of the conductivity goes with Q^(2/3), so the conductivity with
  Q^(4/3); and the thesis replaces Tero's rule by one that keeps the volume. The notes do not have the two foods that
  push each other away, nor the regular lattices.
- **Schenz and Ueda.** The notes say "two extra fields". The model has three fields of the front, two of the waves,
  and a flow with inertia on the tubes. The thesis is of March 2019, not of 2018.
- **Akita et al. 2017.** The trees of the paper on Murray's law drain an arena; they do not lie behind a front. The
  range 2.53 to 3.29 is the interval of a mean.
- **The curvature of 2.5 per mm.** The sentence of the review that holds it ends with a reference to Baumgarten,
  Jones and Hauser 2015, and that paper does not hold the number. Rodiek et al. 2015 is the reference of the sentence
  before it.
- **The radius of 50 µm** is in the review, from Fricker et al. 2017, not in Baumgarten, Jones and Hauser 2015.
- **Masui et al. 2018.** The stop at 0.1 to 1 mm is the case of a third of the encounters that end in avoidance, not
  of every pair that does not fit; "mostly inside the slime" is at least 58.5 % of 41 stops.
- **Clark and Haskins 2012.** The 16 loci are the sum of the review over two species. For _Physarum polycephalum_ it
  reports four fusion loci and three lethal loci.
- **Patino-Ramirez et al. 2019.** With much glucose the plasmodia also grew over left ground more often than chance
  gives. The plasmodia were fed, and the paper's "mucus" is the ground that a plasmodium left.
- **Nakagaki et al. 2000.** The legend of Fig. 1 does not say in words that the plasmodium fills the maze; Tero et al.
  2007 say it. The legend also gives the wet weight.
