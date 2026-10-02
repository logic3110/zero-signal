"""zs-publish: write ``catalog.json`` for a directory of built packs and
optionally copy the web bundles into the PWA (US-15.10).

    zs-publish --dist dist/ --base-url https://cdn.example.org/zerosignal/
    zs-publish --dist dist/ --web-out ../web/public/packs

Uploading to R2/S3/GitHub Releases is a plain file sync of ``dist/`` and is
left to the CI job (e.g. ``aws s3 sync dist/ s3://bucket/``).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import yaml

from . import APP_VERSION
from .settings import BACKEND_ROOT

MODELS_FILE = BACKEND_ROOT / "content" / "models.yaml"


def build_catalog(dist: Path, base_url: str, models_file: Path = MODELS_FILE) -> dict:
    base_url = base_url if base_url.endswith("/") else base_url + "/"
    packs = []
    for sidecar in sorted(dist.glob("*.manifest.json")):
        m = json.loads(sidecar.read_text(encoding="utf-8"))
        files = m.pop("files")
        packs.append(
            {
                **m,
                "size": files["sqlite"]["size"],
                "sha256": files["sqlite"]["sha256"],
                "url": base_url + files["sqlite"]["name"],
                "signature": files["sqlite"].get("signature") or m.get("signature"),
                "web": {
                    "url": base_url + files["web"]["name"],
                    "size": files["web"]["size"],
                    "sha256": files["web"]["sha256"],
                    "signature": files["web"].get("signature"),
                },
            }
        )
    models = yaml.safe_load(models_file.read_text(encoding="utf-8"))["models"] if models_file.exists() else []
    generated = max((p["created_at"] for p in packs), default="1970-01-01T00:00:00Z")
    return {
        "catalog_version": 1,
        "generated_at": generated,
        "app_version": APP_VERSION,
        "packs": packs,
        "models": models,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="zs-publish", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dist", type=Path, required=True)
    ap.add_argument("--base-url", default="/packs/")
    ap.add_argument("--web-out", type=Path, help="copy web bundles + catalog here (e.g. web/public/packs)")
    args = ap.parse_args(argv)

    catalog = build_catalog(args.dist, args.base_url)
    (args.dist / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"catalog.json: {len(catalog['packs'])} packs, {len(catalog['models'])} model packs")

    if args.web_out:
        args.web_out.mkdir(parents=True, exist_ok=True)
        for p in catalog["packs"]:
            name = p["web"]["url"].rsplit("/", 1)[-1]
            shutil.copy2(args.dist / name, args.web_out / name)
        web_catalog = build_catalog(args.dist, "/packs/")
        (args.web_out / "catalog.json").write_text(json.dumps(web_catalog, indent=2), encoding="utf-8")
        print(f"copied {len(catalog['packs'])} web bundles -> {args.web_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
