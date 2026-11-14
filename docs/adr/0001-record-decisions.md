# 0001: Record architecture decisions

- Status: accepted
- Date: 2026-11-08

## Context

The project is built in long sessions with lost context in between. Decisions and their
reasons must survive.

## Decision

Keep one short Markdown ADR per decision in `docs/adr/`, numbered, using
[`0000-template.md`](0000-template.md). Facts with sources go to `docs/knowledge-base/`; ADRs
link to them. A changed decision gets a new ADR that supersedes the old one.

## Consequences

Every non-obvious choice has a file to point to. ADRs must stay short to stay read.

## Amendment 2026-11-14: amendments in place, and a number not used

- A changed or extended decision gets a dated amendment in its own ADR, with its context and reason, and no new ADR
  that supersedes it. This has been the practice since ADR 0003 was revised on 2026-11-09. The record of one topic then
  stays in one file. A new topic still gets a new ADR.
- So an ADR with amendments is not short: ADR 0009 and ADR 0029 hold more than 1,100 lines each. Each amendment starts
  with a heading that names its date, so a reader can go to it.
- The number 0033 was kept on 2026-11-13 for the work on the wall corner of growth. That work became an amendment of
  ADR 0025 (decision 35), so no ADR has the number 0033.
- The choice to record the practice, and not to split the long ADRs, is mine under the owner's delegation of
  2026-11-12: a split would break the links into them and gain nothing a heading does not give.
