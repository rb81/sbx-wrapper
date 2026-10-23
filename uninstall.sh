#!/bin/bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && -z $1 ) ]]; then
    printf 'Usage: bash uninstall.sh [INSTALL_DIRECTORY]\n' >&2
    exit 1
fi

destination=${1:-"$HOME/.local/bin"}
rm -f -- "$destination/sbx-opencode" "$destination/sbx-copilot"
printf 'Removed sbx-opencode and sbx-copilot from %s\n' "$destination"
