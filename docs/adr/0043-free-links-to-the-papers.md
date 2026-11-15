# 0043: Free links to the papers that open without a bot check

- Status: accepted (2026-11-15), built
- Date: 2026-11-15
- Changes [ADR 0037](0037-links-to-the-figures-of-the-papers.md): the host of the link to Jones 2010.

## Context

The owner reported on 2026-11-15: a figure link of a scene, for example
`https://uwe-repository.worktribe.com/980579/1/artl.2010.16.2.pdf#page=9`, shows a check "are you human", and then
the site goes to its start page `https://uwe-repository.worktribe.com/#page=9`, where the PDF cannot be opened. ADR
0037 had assumed that a person in a browser passes the check and reaches the file.

The coordinator checked: the download link, the preview link, the PDF viewer of the site and the record page all
answer HTTP 403 with a Cloudflare challenge, to curl and in the built-in browser. The check was not solved.

The owner also asked whether the app may show the figures of the papers, as it is open source, earns no money and is
hosted on GitHub. A helper read the licence of each paper at its source (the first or last PDF page, the arXiv
abstract page, Crossref). The table is in [`docs/knowledge-base/papers.md`](../knowledge-base/papers.md).

## Options

1. Keep the UWE link and tell the reader to try again. The path is lost after the check, so this does not work.
2. Link the DOI only. `doi.org/10.1162/artl.2010.16.2.16202` goes to `direct.mit.edu`, which also shows a Cloudflare
   challenge, and the article there is not free.
3. Link the copy of the same PDF in the Wayback Machine. It answers HTTP 200 with `application/pdf` and no check, and
   its length is 2,232,898 bytes, the length of the owner's own copy of the file. `#page=` works in a PDF viewer.

## Decision

Option 3, the coordinator's choice under the owner's delegation of 2026-11-12. Reason: it is the only free link that
opens the PDF without a check, and the page numbers of ADR 0037 stay (the same file). The DOI stays as the citation.

- `JONES_PDF` in `src/model/presets.ts` is the Wayback copy
  `https://web.archive.org/web/20260923011704/https://uwe-repository.worktribe.com/preview/980585/artl.2010.16.2.pdf`.
  Every figure link of the eight Jones scenes keeps its page (Fig. 4, 5, 16, 18, 19, 21 and 22 on pages 9, 10, 18,
  19, 20, 21 and 22; the helper checked each caption).
- Learn and the README name the free PDF beside the DOI.
- `papers/`, where the owner keeps the PDFs, is ignored by git, as `artl.2010.16.2.pdf` already was.

On the figures: the answer of ADR 0037 stays for the papers the app shows. Jones 2010 (© MIT), Tero et al. 2010
(AAAS) and Nakagaki et al. 2000 (Springer Nature) are link only. Open source, no income and the host do not change
copyright, and a copy of a PDF in another repository on GitHub gives no right. Of the papers checked, only "Towards a
Physarum learning chip" (CC BY 4.0) allows a figure with attribution, and the cytoskeleton paper (CC BY-NC) with a note
that the figure is not under MIT.

## Consequences

- The figure links of the Jones scenes open the PDF at the figure again.
- The Wayback Machine can remove a capture when the site asks. A test cannot see that without the network; if the link
  breaks, the next capture or a written permission is the way.
- A figure in the app needs the permission of the rights holder: MIT Press and AAAS have permission forms, and the
  authors can be asked for their own pictures.
