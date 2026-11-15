# 0037: Links to the figures of the papers

- Status: accepted (2026-11-14), built
- Date: 2026-11-14
- Changed by [ADR 0043](0043-free-links-to-the-papers.md) (2026-11-15): the link to Jones 2010 goes to the copy of
  the same PDF in the Wayback Machine; the repository loses the path after its bot check.
- Extended by ADR 0045 (2026-11-15): the scene Coarsening network.
- Extended by ADR 0047 (2026-11-15): the scene Electrotaxis.

## Context

The owner asked on 2026-11-14 to put the real pictures of the studies into the descriptions of the scenes, so that a
reader sees what result a scene should reach. A picture of a paper is the work of its publisher or authors. The app
may show one only if its licence allows that.

A research agent checked each source on 2026-11-14, logged out and without a subscription. I checked the main points
again (the record of Jones 2010 over OAI-PMH, the HTTP status of each link, and the page of each figure in the PDF).

| Source                        | Where a reader sees the figure                                                                              | Licence                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Jones 2010, Artificial Life   | The publisher's PDF in the repository of the University of the West of England, open access (record 980579) | None stated; copyright of the publisher            |
| Nakagaki et al. 2000, Nature  | The figure page of Nature, free to view; the article itself is paid                                         | Macmillan, all rights reserved                     |
| Tero et al. 2010, Science     | Science, free to read after a free registration; logged out it shows no figure                              | AAAS, all rights reserved                          |
| Jones 2011, Jones et al. 2017 | Figure pages of Springer; the preprint of 2017 on arXiv                                                     | Publisher; the arXiv licence gives no reuse rights |
| Fogleman 2020                 | The README of his repository; its pictures lie on his website and show none of the presets of this app      | The MIT licence of the code does not name them     |

Details:

- The record of Jones 2010 says "publishedVersion" and "openAccess", and names the file
  `https://uwe-repository.worktribe.com/980579/1/artl.2010.16.2.pdf`. The repository puts a check for bots in front of
  its pages: curl gets HTTP 403, and the built-in browser stopped at the check, which I do not solve. A person in a
  browser passes it. So I did not see the PDF through that link. The page numbers below come from a copy of the same
  file name: page 1 of the PDF is page 127 of the journal, and Fig. 4, 5, 16, 18, 19, 21 and 22 are on pages 9, 10,
  18, 19, 20, 21 and 22.
- The figure page of Nature (`/articles/35035159/figures/1`) and the arXiv page load with HTTP 200 without a login.
  `doi.org/10.1126/science.1177894` gives HTTP 403 to curl; the agent saw the page of Science in a browser.
- The repository of Hiroshima University holds an author copy of Tero et al. 2010 without a login, but it has been
  offline since 2026-10-28 for maintenance.

## Decision

The choices are mine, under the owner's delegation of 2026-11-12.

1. **A link, never the picture.** No figure has a licence that allows the app to show it.
2. **One link per scene whose paper has a figure of its result**, in the scene card under "What to watch" and in the
   details of the scene in Learn: "The result in the paper: Fig. 4, page 9 of the free PDF." It opens in a new tab, so
   the scene keeps running.
   - The eight scenes of Jones 2010: the free PDF, opened at the page of the figure (`#page=`), and the page in the
     text, for a browser that drops the page from the link after the check for bots.
   - Maze: Fig. 1 of Nakagaki et al. 2000 on the figure page of Nature.
   - Tokyo rail network: Fig. 1 of Tero et al. 2010 through its DOI, with the note that Science asks for a free
     registration. Reason: it is the stable address of the paper; the only copy without a login is offline now.
3. **No link** for the scenes made for this app, the scenes "after" a paper (the Foraging maze after Jones 2011 and
   2017, Tokyo, two networks after Tero et al. 2010) and the scenes of Fogleman 2020. Reason: no figure shows the
   result of these scenes. A figure of another arena or of other settings would show a reader a target that the scene
   does not have. Learn names their sources as before.

## Consequences

- `Preset.figure` (`src/model/presets.ts`) holds the link; `presets.test.ts` checks the page of each figure of Jones
  2010, the two other links and that no other scene has one.
- A link can break when a publisher or a repository moves a file. The DOI of each paper stays in Learn.
- If an author or a publisher allows the app to show a figure, a scene can show it with that licence.
