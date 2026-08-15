#!/usr/bin/env bash
#
# Stamps a new version across every file that must hard-code it, then verifies
# that nothing was missed.
#
#   ./bump-version.sh 0.1.181
#
# APP_VERSION in app.js is the source of truth at runtime. Anything that can read
# it at runtime already does (the version badge, the firebase-sync import, the
# service worker registration query). This script exists for the handful of sites
# that physically cannot, because they load before app.js or run in another
# context: the bootstrap <script> tag, the service worker cache name, and the
# firebase-sync imports in the standalone share/login pages.
#
# The service worker cache name is bumped automatically, which is what forces
# clients off stale cached assets.

set -euo pipefail
cd "$(dirname "$0")"

NEW="${1:-}"
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <version>   e.g. $0 0.1.181" >&2
  exit 1
fi

CUR=$(sed -n "s/^var APP_VERSION = '\([^']*\)';/\1/p" app.js)
if [[ -z "$CUR" ]]; then
  echo "error: could not read APP_VERSION from app.js" >&2
  exit 1
fi
echo "bumping $CUR -> $NEW"

CACHE_CUR=$(sed -n "s/^var CACHE = 'volleystat-v\([0-9]*\)';/\1/p" sw.js)
CACHE_NEW=$((CACHE_CUR + 1))

sed -i.bak "s/^var APP_VERSION = '.*';/var APP_VERSION = '$NEW';/" app.js
sed -i.bak "s|src=\"app.js?v=[^\"]*\"|src=\"app.js?v=$NEW\"|" index.html
sed -i.bak "s|<span class=\"title-bar-badge\">Alpha [^<]*</span>|<span class=\"title-bar-badge\">Alpha $NEW</span>|" index.html
sed -i.bak "s|pairs with APP_VERSION .*\*/|pairs with APP_VERSION $NEW */|" sw.js
sed -i.bak "s|^var CACHE = 'volleystat-v[0-9]*';|var CACHE = 'volleystat-v$CACHE_NEW';|" sw.js
sed -i.bak "s|firebase-sync.js?v=[0-9.]*'|firebase-sync.js?v=$NEW'|" share.html login.html
rm -f ./*.bak

# Fail loudly if any stale version string survived.
STALE=$(grep -rnoE "0\.1\.[0-9]+" --include='*.js' --include='*.html' \
          --exclude-dir=files --exclude-dir=node_modules . \
        | grep -v "$NEW" || true)
if [[ -n "$STALE" ]]; then
  echo "error: stale version strings remain:" >&2
  echo "$STALE" >&2
  exit 1
fi

node --check app.js
echo "ok: all version sites now $NEW, sw cache volleystat-v$CACHE_NEW"
echo
echo "next:  git commit -am 'Bump to $NEW' && firebase deploy --only hosting"
