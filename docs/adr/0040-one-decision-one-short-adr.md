# 0040: One decision, one short ADR, and a guide for agents

- Status: accepted (decision of the owner, 2026-11-15)
- Date: 2026-11-15
- Changes [ADR 0001](0001-record-decisions.md), amendment of 2026-11-14.

## Context

Since 2026-11-09 a changed or extended decision got a dated amendment in its own ADR (ADR 0001, amendment of
2026-11-14). So the record of a topic stayed in one file, and the files grew: `0029-flow-in-the-tubes.md` had 2,069
lines with 20 decisions, a review, a correction and four amendments, and ADR 0009 has 1,196.

Agents read these files again and again. Every step of an agent reads its whole history again, and a file it read once
stays in that history. In the night of 2026-11-14 to 2026-11-15 (22:07 to 10:40 UTC) the coordinator and nine helpers
used about 139 million weighted tokens (cache reads 0.1, cache writes 2, output 5). The helpers used 89 % of it, and
80 to 88 % of the cost of each large helper was the reading of its own history again, which grew to 300,000 to
850,000 tokens. The helpers also polled their GPU runs every few minutes: 17 % of their usage. The numbers come from
the transcripts of that session.

Each brief to a helper repeated the same rules (DCO, ports, both backends, `docs/model.md`, the archive of the logs),
and helpers searched the repository for where things are.

## Options

1. Keep the amendments, and teach agents to read only the headed part. Cheap, but each new amendment still makes the
   file longer, and an agent must first find its part.
2. A new short ADR for each new decision, also when it extends an earlier one; the earlier ADR gets one line that
   points to the new one. The old files stay as they are.
3. Split the long ADRs into one file per decision. Shorter files, but it breaks the links into them, and the split is
   work that changes no decision.

## Decision

Option 2. The owner decided on 2026-11-15: "Ja, neue ADRs". The coordinator recommended it to make the files that an
agent must read shorter.

- A new decision gets a new ADR from `0000-template.md`, also when it extends or changes an earlier one. The earlier
  ADR gets one line in its header list: "Extended by ADR NNNN" or "Changed by ADR NNNN", with the date.
- An ADR holds the decision, its reason, who decided and the numbers that carry it. Long tables of runs go to the story
  of `research/<topic>/README.md` and to the archive of the logs.
- The ADRs that exist stay as they are (not option 3): their links and their headings keep working.

The owner also asked on 2026-11-15 for a `CLAUDE.md` and an `AGENTS.md`. `AGENTS.md` in the root is the guide for
every agent: the aims, where things are, the commands, the rules of a change, and how to work with less usage.
`CLAUDE.md` loads it (`@AGENTS.md`) and adds what holds only for Claude Code. Every agent loads both files in every
turn, so they stay short. Their rules come from the ADRs and from the practice of this repository; neither file makes
a new rule of the model.

## Consequences

- An agent that works on one decision reads a short ADR, not the whole history of its topic.
- A topic is spread over several files. The header lines of the first ADR list the later ones, so a reader still finds
  them.
- Briefs to helpers get shorter: they name the task and the files, and the rules are in `AGENTS.md`.
- `AGENTS.md` costs tokens in every turn of every agent. A rule that holds only for one task belongs in the brief of
  that task, not in `AGENTS.md`.
- The paused work on a second Tokyo scene with light (ADR 0029, decision 20, branch `scene/tokyo-with-light`) gets its
  own ADR when it goes on, not an amendment of ADR 0029.
