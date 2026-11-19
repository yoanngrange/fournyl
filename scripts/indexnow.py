"""Tell IndexNow search engines (Bing and others) about every page of the live site, after a deploy.

    python3 scripts/indexnow.py            # reads the live sitemaps, submits their URLs in batches of 10,000

Standard library only (the deploy job has no project environment). The key is in pipeline/config.py and served at
<site>/<key>.txt, which proves the site is ours. A failure is reported but never fails the deploy.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CONFIG = (ROOT / "pipeline" / "config.py").read_text()
KEY = re.search(r'INDEXNOW_KEY = "([0-9a-f]+)"', CONFIG).group(1)
SITE = re.search(r'SITE_URL = os.environ.get\("SITE_URL", "([^"]+)"\)', CONFIG).group(1)
ENDPOINT = "https://api.indexnow.org/indexnow"
BATCH = 10_000
UA = {"User-Agent": "Mozilla/5.0 (fournyl IndexNow)"}


def get(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode()


def urls() -> list[str]:
    index = get(SITE + "sitemap.xml")
    maps = re.findall(r"<sitemap><loc>(.*?)</loc>", index) or [SITE + "sitemap.xml"]
    return [u for m in maps for u in re.findall(r"<url><loc>(.*?)</loc>", get(m))]


def submit(batch: list[str]) -> int:
    body = json.dumps({"host": urlparse(SITE).hostname, "key": KEY, "keyLocation": f"{SITE}{KEY}.txt", "urlList": batch}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={**UA, "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main() -> int:
    try:
        if get(f"{SITE}{KEY}.txt").strip() != KEY:
            print("IndexNow: key file not served yet, skipped")
            return 0
        all_urls = urls()
        for i in range(0, len(all_urls), BATCH):
            print(f"IndexNow: {len(all_urls[i:i + BATCH])} URLs -> HTTP {submit(all_urls[i:i + BATCH])}")
    except Exception as err:  # noqa: BLE001 - never fail a deploy because of a ping
        print(f"IndexNow: not submitted ({err})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
