# Papers: free links and licences

The papers of Jones and colleagues that the owner collected on 2026-11-15, with a free link that opens without a bot
check and the licence of each copy (ADR 0043). Checked on 2026-11-15: the arXiv licences on the abstract pages, the
first or last page of each PDF, and Crossref. The repository of the University of the West of England
(`uwe-repository.worktribe.com`) shows a bot check on every page and then loses the path, so no link goes there.

Licences, in short (not legal advice):

- **CC BY 4.0**: a figure may be shown with the authors, the source, the DOI and the licence named.
- **CC BY-NC**: the same, for non-commercial use only; such a figure in this MIT-licensed repository needs its own
  licence note, because MIT allows commercial use.
- **arXiv non-exclusive licence** and **all rights reserved**: a link only. A figure needs the permission of the rights
  holder, or a quotation that our own text discusses (§ 51 UrhG).

| Paper                                                                   | Year, venue                                    | DOI                              | Free link                                                                                                                                        | Licence                                    | Figures   |
| ----------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------- |
| Characteristics of pattern formation and evolution … (Jones)            | 2010, Artificial Life 16(2)                    | 10.1162/artl.2010.16.2.16202     | [Wayback copy of the UWE PDF](https://web.archive.org/web/20260923011704/https://uwe-repository.worktribe.com/preview/980585/artl.2010.16.2.pdf) | © MIT (PDF page 1)                         | link only |
| Exploiting environmental computation … (Jones)                          | 2015, AIP Conf. Proc. 1648                     | 10.1063/1.4912814                | [arXiv:1511.07647](https://arxiv.org/abs/1511.07647)                                                                                             | arXiv non-exclusive                        | link only |
| Material approximation of data smoothing and spline curves …            | 2014, Bioinspir. Biomim. 9                     | 10.1088/1748-3182/9/3/036016     | [arXiv:1503.03264](https://arxiv.org/abs/1503.03264)                                                                                             | arXiv non-exclusive                        | link only |
| Computation of the travelling salesman problem by a shrinking blob      | 2014, Natural Computing 13                     | 10.1007/s11047-013-9401-x        | [arXiv:1303.4969](https://arxiv.org/abs/1303.4969)                                                                                               | arXiv non-exclusive                        | link only |
| On the role of the plasmodial cytoskeleton …                            | 2015, Communicative & Integrative Biology 8(4) | 10.1080/19420889.2015.1059007    | [PMC4594612](https://pmc.ncbi.nlm.nih.gov/articles/PMC4594612/)                                                                                  | CC BY-NC (published version, page 1)       | with note |
| Network coarsening dynamics in a plasmodial slime mould …               | 2015, Acta Phys. Pol. B 46(6)                  | 10.5506/APhysPolB.46.1201        | [journal PDF](https://www.actaphys.uj.edu.pl/R/46/6/1201/pdf)                                                                                    | none stated                                | link only |
| Multi-agent model of slime mould for computing and robotics             | 2015, Atlas of Physarum Computing              | 10.1142/9789814675321_0002       | none found                                                                                                                                       | publisher                                  | link only |
| Towards a Physarum learning chip                                        | 2016, Sci. Rep. 6                              | 10.1038/srep19948                | [Nature PDF](https://www.nature.com/articles/srep19948.pdf)                                                                                      | CC BY 4.0 (PDF, last page)                 | yes       |
| Evaluation of French motorway network …                                 | 2017, Environ. Plan. B 44                      | 10.1177/0265813515626924         | none checked                                                                                                                                     | publisher                                  | link only |
| Slime mould inspired generalised Voronoi diagrams with repulsive fields | 2015, preprint                                 | 10.48550/arXiv.1503.06973        | [arXiv:1503.06973](https://arxiv.org/abs/1503.06973)                                                                                             | arXiv non-exclusive                        | link only |
| Emergence of self-organized amoeboid movement …                         | 2012, Bioinspir. Biomim. 7                     | 10.1088/1748-3182/7/1/016009     | [arXiv:1212.0023](https://arxiv.org/abs/1212.0023)                                                                                               | © IOP (proof, page 1); arXiv non-exclusive | link only |
| Sounds synthesis with slime mould of Physarum polycephalum              | 2011, J. Bionic Eng. 8                         | 10.1016/S1672-6529(11)60016-4    | [arXiv:1212.1203](https://arxiv.org/abs/1212.1203)                                                                                               | arXiv non-exclusive                        | link only |
| Routing Physarum with electrical flow/current                           | 2011, Int. J. Nanotechnol. Mol. Comput. 3      | 10.4018/jnmc.2011040104          | [arXiv:1204.1752](https://arxiv.org/abs/1204.1752)                                                                                               | arXiv non-exclusive                        | link only |
| Slime mould logic gates based on frequency changes …                    | 2014, Biosystems 124                           | 10.1016/j.biosystems.2014.08.001 | [arXiv:1406.2021](https://arxiv.org/abs/1406.2021)                                                                                               | arXiv non-exclusive                        | link only |
| Rules for biologically inspired adaptive network design (Tero et al.)   | 2010, Science 327                              | 10.1126/science.1177894          | none verified                                                                                                                                    | AAAS                                       | link only |
| Maze-solving by an amoeboid organism (Nakagaki et al.)                  | 2000, Nature 407                               | 10.1038/35035159                 | [figure page](https://www.nature.com/articles/35035159/figures/1)                                                                                | Springer Nature                            | link only |

Notes:

- The arXiv copies are author manuscripts: their page numbers differ from the journal versions.
- OpenAlex tags several UWE copies as CC BY, also ones whose PDF says © MIT or © IOP. That looks like a default of the
  repository, not a grant of the rights holder; only a written answer of UWE or the publisher would change "link only".
- A copy of a paper in another repository on GitHub gives no right to its figures.

## What the papers give the app, and what not

Read on 2026-11-15 for corrections and extensions of the model. What the app can build is in `TODO.md`, section "From
the papers read on 2026-11-15"; the corrections went into ADR 0044 and `docs/fidelity.md`, the coarsening into ADR 0045. These parts give the app nothing to build, each for its reason:

- The cytoskeleton paper: no rule, no parameter and no number about behaviour; the actin automata and the graphs of
  nuclei are another model.
- Data smoothing and splines: the scene needs a timed removal of the stimulus and a halt of all movement, shows no
  behaviour of the organism, and names no lattice, kernel or damping.
- Sound synthesis and the logic gates: the surface potential (±40 mV) would be a read-out the app invents, as the app
  has no electrical state; the gates, thresholds and sounds are about computing. Their frequency numbers are test
  targets for a later model of shuttle streaming (`TODO.md`, Later).
- The learning chip: the AC stimulation at 10 Hz and 1000 Hz maps to plain positive and negative stimuli in the paper
  itself (p. 4); the rise of the baseline after repeated stimuli is a result of the model, not of the organism.
- Heat as an attractant (+19.8 % frequency, logic gates, Table 1): one number, and the app has no temperature field.
- The Oregonator model in the routing paper: another class of model.
- "Damping 0.07" in the amoeboid paper (p. 3): it is not clear whether it is a decay, and the paper names no lattice or
  deposit.
- The multi-agent model for computing and robotics: no free copy found.
