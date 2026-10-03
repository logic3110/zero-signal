"""Vercel entrypoint: the ZeroSignal FastAPI app as a Python function.

vercel.json rewrites /api/* and /packs/*.sqlite|.sig here; the PWA itself is
served statically from web/dist. Packs are built into backend/dist during the
Vercel build. If they did not make it into the function bundle, they are
rebuilt into /tmp on cold start (takes about a second).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

PACK_CONFIGS = ["core", "medical-core", "survival-core", "vehicle-core"]


def _packs_dir() -> Path:
    if "ZS_PACKS_DIR" in os.environ:
        return Path(os.environ["ZS_PACKS_DIR"])
    built = BACKEND / "dist"
    if any(built.glob("*.sqlite")):
        return built
    from zerosignal.build import main as zs_build

    tmp = Path("/tmp/zerosignal-packs")
    if not any(tmp.glob("*.sqlite")):
        argv = [a for name in PACK_CONFIGS for a in ("--config", str(BACKEND / "content" / "packs" / f"{name}.yaml"))]
        if zs_build([*argv, "--out", str(tmp)]) != 0:
            raise RuntimeError("zs-build failed")
    return tmp


os.environ["ZS_PACKS_DIR"] = str(_packs_dir())
os.environ.setdefault("ZS_WEB_DIST", "")  # web/dist is served by Vercel, not by FastAPI

from zerosignal.api.app import create_app  # noqa: E402

app = create_app()
