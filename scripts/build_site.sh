#!/usr/bin/env bash
# Assemble the static site into _site/ (same layout as scripts/serve.py serves locally).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _site
cp -R public _site
cp -R src _site/src
uv run python -m pipeline.pages _site
# Service worker cache version: one per build, so a deploy refreshes the app shell.
sed -i.bak "s/__BUILD__/$(date -u +%Y%m%d%H%M%S)/" _site/sw.js && rm _site/sw.js.bak
# GitHub Pages refuses sites over 1 GB: fail here, with the size, rather than at deploy time.
bytes=$(find _site -type f -print0 | xargs -0 cat | wc -c | tr -d ' ')
echo "Site assembled in _site/ ($(find _site -type f | wc -l | tr -d ' ') files, $((bytes / 1000000)) MB)"
if [ "$bytes" -gt 1000000000 ]; then echo "ERROR: site over 1 GB (GitHub Pages limit)" >&2; exit 1; fi
if [ "$bytes" -gt 900000000 ]; then echo "WARNING: site over 900 MB, close to the 1 GB GitHub Pages limit" >&2; fi
