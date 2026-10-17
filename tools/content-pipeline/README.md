# Content extraction pipeline (optional provenance tools)

The normal build uses the reviewed JSON in `data/`. **You do not need these Python scripts, a PDF, or an AoN dump to build packs or a release.** These historical extraction tools are preserved for auditability; their full extraction has not been reproduced in the repository-preparation pass.

Requires Python 3.11+ and Poppler (`pdftotext`). Source PDFs and scraped input dumps are not distributed. Paths are portable and resolved relative to the repository, not a developer's home directory.

## Working directories

By default, inputs live in `.work/content-pipeline/inputs`, intermediate files in `.work/content-pipeline`, and candidate output in `.work/content-pipeline/output`. Override them with `TSC_PIPELINE_INPUT`, `TSC_PIPELINE_WORK`, and `TSC_PIPELINE_OUTPUT` environment variables. Keep all three outside tracked source data.

Input names used by the scripts include `aon.txt`, `haz_aon.txt`, and `aon-upgrades.json`; PDF extraction takes an explicit input path. Review each script's expected intermediate files before running it: this is a collection of provenance tools, not a single unattended import command.

1. `python tools/content-pipeline/extract_stream.py PDF FIRST LAST OUT` uses `pdftotext -bbox-layout` to produce a column-aware stream. The original extraction used pages 207–247 for ships and 247–258 for hazards; page numbering depends on the PDF edition.
2. `seg.py` splits the stream into `blocks.json`.
3. `parse_aon.py` parses ship headers, statistics and common actions from `aon.txt`, and derives `aon_names.json`.
4. `parse_pdf.py` rebuilds statblocks from PDF blocks, including continuations, strikes and action costs.
5. `merge.py` matches PDF and AoN records, prefers PDF statistics on conflicts and writes candidate faction files under the output directory. **It does not overwrite `data/`.** Review and copy approved results manually.
6. `parse_haz.py` and `build_haz.py` handle hazards, using the committed hazard data as a baseline.
7. `parse_upgrades.py` processes the optional upgrades inputs; see its command-line arguments.

`ship-report.json` records the historical reconciliation, not a newly executed audit.

## Style checks

```sh
python -m pip install -r tools/content-pipeline/requirements-dev.txt
python -m black --check tools/content-pipeline
python -m compileall -q tools/content-pipeline
```

Python uses Black; JavaScript, styles and documentation use the repository's Prettier configuration. Do not commit source PDFs, input dumps, intermediate files, caches or generated packs.
