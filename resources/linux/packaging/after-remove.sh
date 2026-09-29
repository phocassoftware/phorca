#!/bin/bash
# Why: remove the PATH symlink that after-install.sh created, but only if it
# still points into the Phorca install dir — never delete an unrelated
# /usr/bin/phorca-ide a user or other package may own.
set -e

# RPM passes an instance count; dpkg passes the package lifecycle action.
case "${1-}" in
  0 | remove | purge) ;;
  *) exit 0 ;;
esac

link="/usr/bin/phorca-ide"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/Phorca/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0
