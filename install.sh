#!/usr/bin/env bash
# Installs Study Website for the current user and adds it to the KDE app menu.
# Run after building:  cargo tauri build --no-bundle   (or cargo tauri build)
set -euo pipefail
cd "$(dirname "$0")"

BIN="src-tauri/target/release/study-website"
if [[ ! -x "$BIN" ]]; then
  echo "Build it first:  cargo tauri build --no-bundle"
  exit 1
fi

mkdir -p ~/.local/bin ~/.local/share/applications ~/.local/share/icons/hicolor/512x512/apps
install -m 755 "$BIN" ~/.local/bin/study-website
install -m 644 src-tauri/icons/icon.png ~/.local/share/icons/hicolor/512x512/apps/study-website.png

cat > ~/.local/share/applications/study-website.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Study Website
Comment=Flashcards, quizzes, and exams from your question banks
Exec=$HOME/.local/bin/study-website
Icon=study-website
Categories=Education;
Terminal=false
DESKTOP

update-desktop-database ~/.local/share/applications 2>/dev/null || true
echo "Installed. Look for \"Study Website\" in your app launcher."
