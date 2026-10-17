"""Local paths for the optional provenance pipeline; licensed source inputs are not bundled."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(os.environ.get("TSC_PIPELINE_WORK", ROOT / ".work" / "content-pipeline"))
INPUT = Path(os.environ.get("TSC_PIPELINE_INPUT", WORK / "inputs"))
OUTPUT = Path(os.environ.get("TSC_PIPELINE_OUTPUT", WORK / "output"))
WORK.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / "starships").mkdir(exist_ok=True)
