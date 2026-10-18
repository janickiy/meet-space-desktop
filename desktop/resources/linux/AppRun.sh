#!/bin/sh
set -eu

# AppImage runtime normally supplies APPDIR. Extraction also remains usable.
# Sandbox initialization belongs to Chromium; launcher failure never relaxes it.
if [ -z "${APPDIR:-}" ]; then
  APPDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
fi
case "$APPDIR" in /*) ;; *) exit 1 ;; esac
if [ ! -d "$APPDIR" ] || [ ! -x "$APPDIR/meetspace-test" ]; then
  echo 'The MeetSpace AppImage payload is incomplete.' >&2
  exit 1
fi
export APPDIR
export XDG_DATA_DIRS="$APPDIR/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$APPDIR/meetspace-test" "$@"
