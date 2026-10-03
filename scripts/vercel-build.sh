#!/usr/bin/env bash
# Vercel build: knowledge packs (Python) -> backend/dist + web/public/packs, then the PWA.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  python3 -m pip install --quiet --user uv
  export PATH="$HOME/.local/bin:$PATH"
fi

VENV=.vercel-build-venv
uv venv --quiet --python 3.12 "$VENV"
uv pip install --quiet --python "$VENV/bin/python" ./backend

(
  cd backend
  ../$VENV/bin/zs-build \
    --config content/packs/core.yaml --config content/packs/medical-core.yaml \
    --config content/packs/survival-core.yaml --config content/packs/vehicle-core.yaml \
    --out dist
  ../$VENV/bin/zs-publish --dist dist --web-out ../web/public/packs
)
rm -rf "$VENV" backend/build

cd web
npm run build
