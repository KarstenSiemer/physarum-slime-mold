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
