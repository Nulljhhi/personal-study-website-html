# Study Website

Flashcards, quizzes, matching tiles, and exams from your own plain-text question banks.
Saved banks, completed questions, and checkpoints live in `Documents/StudyWebsite`.

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

If you'd rather not install anything, open `src/index.html` in any browser. Everything works except the folder features (saved banks and checkpoint tiles).

---

## For the maintainer

### Publishing a new version

1. Bump `"version"` in `src-tauri/tauri.conf.json` (for example `1.0.0` → `1.1.0`).
2. Commit, tag, and push:

       git commit -am "Release v1.1.0"
       git tag v1.1.0
       git push && git push --tags

3. The **Release** workflow (Actions tab) builds Windows, Mac, and Linux versions in about 10–20 minutes and attaches them to a new release. Share the release link.

The tag must match the version in `tauri.conf.json`, with a `v` in front.

### Building on your own machine (Arch)

    sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool rustup
    rustup default stable
    cargo install tauri-cli --version "^2" --locked

    cargo tauri dev                 # run it for testing
    cargo tauri build --no-bundle   # binary at src-tauri/target/release/study-website
    ./install.sh                    # copy to ~/.local/bin and add to the KDE app menu

### Troubleshooting

- The app opens fullscreen and is designed for 1920×1080. Close it with **Quit** on the start screen (Alt+F4 also works).
- Blank or white window on Linux: start it with `WEBKIT_DISABLE_DMABUF_RENDERER=1 study-website`.
- The HTML is built into the app, so after editing `src/index.html` you have to rebuild.
