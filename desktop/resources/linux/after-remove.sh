#!/bin/sh
set -eu

# Package managers remove the package's files. Profiles, downloads, credentials,
# opt-in autostart entries and MIME defaults belong to the user and stay intact.
if [ -x /usr/bin/update-desktop-database ]; then
  /usr/bin/update-desktop-database /usr/share/applications || true
fi
if [ -x /usr/bin/gtk-update-icon-cache ]; then
  /usr/bin/gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
