#!/bin/sh
set -eu

# This hook only prepares the package-owned Chromium sandbox and refreshes
# system application caches. It does not change user settings or MIME defaults.
if [ "$(/usr/bin/id -u)" != 0 ]; then
  echo 'MeetSpace package configuration requires the package manager.' >&2
  exit 1
fi

for directory in /opt '/opt/meetspace-desktop-test'; do
  if [ ! -d "$directory" ] || [ -L "$directory" ]; then
    echo 'MeetSpace package directory is not an ordinary directory.' >&2
    exit 1
  fi
  owner=$(/usr/bin/stat -c '%u:%g' "$directory")
  permissions=$(/usr/bin/stat -c '%a' "$directory")
  case "$permissions" in ''|*[!0-7]*) exit 1 ;; esac
  if [ "$owner" != 0:0 ] || [ "$((0$permissions & 022))" -ne 0 ]; then
    echo 'MeetSpace package directory permissions are unsafe.' >&2
    exit 1
  fi
done

sandbox='/opt/meetspace-desktop-test/chrome-sandbox'
if [ ! -f "$sandbox" ] || [ -L "$sandbox" ] ||
   [ "$(/usr/bin/stat -c '%u:%g:%h' "$sandbox")" != 0:0:1 ]; then
  echo 'MeetSpace package sandbox ownership is invalid.' >&2
  exit 1
fi
/usr/bin/chmod 4755 "$sandbox"

if [ -x /usr/bin/update-desktop-database ]; then
  /usr/bin/update-desktop-database /usr/share/applications || true
fi
if [ -x /usr/bin/gtk-update-icon-cache ]; then
  /usr/bin/gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
