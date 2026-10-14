# Study Website

Flashcards, quizzes, matching tiles, exams, a Study Garden and eight study games from your own plain-text question banks.
Questions can have pictures: load a .zip with the unit file and images named `Img.Q1.png`, `Img.Q2.jpg` and so on (by question number). Hotspot questions (`hotspot: x, y`) are answered by clicking the right spot on the picture.
Saved banks, completed questions, game progress and checkpoints live in `Documents/StudyWebsite`.

Games: Boss Battle (endless, plus a 25-boss campaign with gear and a Gauntlet), Survival (biomes and perks), Blitz (a league ladder and variants), Fishing (weather, time of day, bounties and an aquarium), Warehouse Tycoon, Hold the Line (tower defense), Quiz Rally (racing) and Deep Delve (a 100-floor dungeon crawl with an outfitter). Bots play at your skill-based rating, and Boss Battle, Quiz Rally and Deep Delve have quick distraction minigames.
Each game has its own level (1–30) with an unlock track, three session challenges, achievements and a Reset progress button.
Study Garden (on the start screen, under the Study Sessions button) turns spaced review into a garden: plants need water on a 1/3/7/14/30-day schedule, and a plant in full bloom marks its question completed.
Question timers are sized to the question: reading time (set your reading speed on any game's setup screen or in the garden) plus thinking time.

## Download

Get the latest version from the **Releases** page of this repository (right side of the repo page).

| System | File to download |
| --- | --- |
| Windows 10/11 | `Study Website_x.y.z_x64-setup.exe` |
| Mac with Apple chip (M1 or newer) | `Study Website_x.y.z_aarch64.dmg` |
| Older Intel Mac | `Study Website_x.y.z_x64.dmg` |
| Linux (any distro) | `Study Website_x.y.z_amd64.AppImage` |
| Ubuntu / Debian | `Study Website_x.y.z_amd64.deb` |

The app isn't code-signed, so each system warns you the first time:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**. It installs for your user only; no admin needed.
- **Mac:** open the .dmg and drag the app to Applications. The first launch is blocked. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. Allow Documents access when asked.
- **Linux AppImage:** right-click → Properties → allow executing as a program (or `chmod +x`), then double-click. On Arch, install `fuse2` if it won't start.
- **Linux .deb:** `sudo apt install ./Study*.deb`

If you'd rather not install anything, open `src/index.html` in any browser. Everything works except the folder features (saved banks and checkpoint tiles), and progress is saved in that browser's own storage (a private window may keep it for that session only).

---

## For the maintainer

### Where the code lives

- `app/` holds the page's source, split into readable pieces: `app/index.html` (markup), `app/styles/*.css`, and `app/scripts/*.js` (numbered so they run in order: the study modes first, then shared game systems, one file per game, the bots and rivals, the game engine, and start-up wiring).
- `src/index.html` is built from those with `node tools/build.js` and is what the app runs. Edit the files in `app/`, rebuild, and commit both; `node tools/build.js --check` (also run by the release workflow) fails if they don't match.
- `src-tauri/src/` is the desktop side: `store.rs` (banks, bank IDs, progress, checkpoints, rename and delete), `files.rs` (safe names and writes), `titles.rs`, `drops.rs`, and `main.rs` (the commands the page calls).

### Publishing a new version

1. Bump the version in both `src-tauri/tauri.conf.json` (`"version"`) and `src-tauri/Cargo.toml` (`version = ...` under `[package]`), for example `1.0.0` → `1.1.0`, then run `cargo check` in `src-tauri` so `Cargo.lock` picks up the new version too.
2. Commit (including `Cargo.lock`), tag, and push:

       git commit -am "Release v1.1.0"
       git tag v1.1.0
       git push && git push --tags

3. The **Release** workflow (Actions tab) builds Windows, Mac, and Linux versions in about 10–20 minutes into a hidden draft release, and makes it public once all of them have built. If one fails, nothing is published: delete the draft under **Releases**, fix the problem, and run it again. Share the release link.

The tag must match the version in `tauri.conf.json` and `Cargo.toml`, with a `v` in front; the workflow stops if they differ.

### Building on your own machine (Arch)

    sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool rustup
    rustup default stable
    cargo install tauri-cli --version "^2" --locked

    node tools/build.js             # after editing anything in app/
    cargo tauri dev                 # run it for testing
    cargo tauri build --no-bundle   # binary at src-tauri/target/release/study-website
    ./install.sh                    # copy to ~/.local/bin and add to the KDE app menu

### Troubleshooting

- The app opens fullscreen and is designed for 1920×1080. Press **F11** to switch to a normal, resizable window; the layout scales to fit, and narrow windows get a stacked layout. Close it with **Quit** on the start screen (Alt+F4 also works); both wait for any save in progress.
- Blank or white window on Linux: start it with `WEBKIT_DISABLE_DMABUF_RENDERER=1 study-website`.
- The HTML is built into the app, so after editing `src/index.html` you have to rebuild.

## Tests

- Rust: `cd src-tauri && cargo test` (saving, renaming, crash recovery, the picture store, and what happens when the disk refuses a write)
- Frontend (Playwright + Chromium): `cd tests && npm ci && npx playwright install chromium && npm test` (`npm ci` installs exactly the versions in `package-lock.json`). `PW_BROWSER=webkit npm test` runs them in WebKit instead, after `npx playwright install webkit`. `core.test.js` runs the parser, hotspots and zip reader in plain Node, with no browser.
- Script checks: `node tools/check-scripts.js` (after `npm ci` in `tests/`). All of `app/scripts/` runs in one shared scope, so this catches a name declared in two files, a name declared nowhere, and top-level code that uses a variable from a later file. It also makes sure `01-core.js` and the zip reader (which runs in a background worker) stand on their own.
- The **CI** workflow runs all of these on every push and pull request, with the Rust tests on Linux, Windows and macOS, and the browser tests in Chromium (required) and WebKit (for information). The release workflow runs them again, checks that the tag matches the version in `tauri.conf.json` and `Cargo.toml`, and runs the Rust tests on each system before building it.

