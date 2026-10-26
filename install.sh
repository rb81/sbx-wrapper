#!/bin/bash
set -euo pipefail

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
destination=${1:-"$HOME/.local/bin"}
mkdir -p "$destination"
install -m 755 "$source_dir/sbxw" "$destination/sbxw"
rm -f -- "$destination/sbx-opencode" "$destination/sbx-copilot"
printf 'Installed sbxw in %s\n' "$destination"
printf 'Removed the old sbx-opencode and sbx-copilot commands from %s\n' "$destination"
printf 'Ensure that directory is on your PATH.\n'
