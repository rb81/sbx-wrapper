#!/bin/bash
set -euo pipefail

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
destination=${1:-"$HOME/.local/bin"}
mkdir -p "$destination"
install -m 755 "$source_dir/sbx-wrapper" "$destination/sbx-opencode"
install -m 755 "$source_dir/sbx-wrapper" "$destination/sbx-copilot"
printf 'Installed sbx-opencode and sbx-copilot in %s\n' "$destination"
printf 'Ensure that directory is on your PATH.\n'
