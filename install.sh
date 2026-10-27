#!/bin/sh
# Symlink the scripts into place so edits in this repo are live.
set -e
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.local/bin" "$HOME/.pi/agent/extensions"
for f in herdr-index herdr-search; do
  ln -sf "$here/bin/$f" "$HOME/.local/bin/$f"
done
ln -sf "$here/extension/semantic-search.ts" "$HOME/.pi/agent/extensions/semantic-search.ts"
echo "Installed. Reload pi to pick up the extension; see README for the optional Herdr sidebar indicator."
