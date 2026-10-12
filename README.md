# <img src="./src-tauri/icons/128x128.png" width="64"/> Ispliced
**Ispliced** is an alternative frontend for the popular [Splice](https://splice.com/features/sounds) sample library. It does not require any kind of authentication, and contains all of the most important features of the regular desktop app (including drag-and-drop).

<p align="center">
  <a href="https://github.com/ascpixi/splicedd/releases/"><code>click here to download the latest release!</code></a>
  <br><br>
  <img src="./etc/screenshot.png">
</p>

Basic demo  | Drum loop demo 
------------|---------------
<video src="https://github.com/ascpixi/splicedd/assets/44982772/4406e3a2-1361-4198-baf9-cca5b4fb62af"> | <video src="https://github.com/ascpixi/splicedd/assets/44982772/02dda4ce-d61c-4240-8759-bbd18c31de24">

## macOS
Ispliced isn't notarized by Apple, so macOS will block it the first time you open it. To allow it, either:
- open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the message about Ispliced, or
- run `xattr -dr com.apple.quarantine /Applications/Ispliced.app` in the Terminal.

You only need to do this once.

## Browsing packs

Choose **Sample packs** to browse pack artwork and search by pack name. The same
instrument, genre, tag, key, BPM, sample type and sorting controls are available
in both views. Audio filters show packs containing matching samples. Filtered
pack searches scan all matching sample pages, so broad filters can take longer;
changing the search cancels the remaining scan.

Click a pack to open all its samples, with pagination for larger packs. **Back to
packs** restores the search and filters used to find it.

## Development

Install dependencies with `yarn install --frozen-lockfile`, then run `yarn dev`
for the browser UI with mock samples and pack artwork. Audio playback, sample
downloads and native drag-and-drop require the desktop shell (`yarn tauri dev`)
and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Run `yarn build` for TypeScript checks and the production frontend, `yarn test`
for search tests, and `yarn test:browser` for browser navigation and filtering
tests. Install the test browser with `yarn playwright install chromium`, or set
`CHROMIUM_PATH` to an existing Chromium executable.

The desktop product, window title and release bundles use **Ispliced**. The
existing application identifier is retained so saved settings remain available.

## Compile a Windows executable (Visual Studio 2026)

Build on Windows. In **Visual Studio Installer → Visual Studio 2026 → Modify**,
install **Desktop development with C++**, including the MSVC x64/x86 build tools
and a Windows 10 or Windows 11 SDK. The full IDE or Build Tools edition works;
this is a Tauri/Rust project, so no Visual Studio solution file is needed.

Install [Node.js](https://nodejs.org/) (22 LTS or newer),
[Rust through rustup](https://rustup.rs/), and the
[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
Open PowerShell or a terminal in the repository directory and prepare the tools:

```powershell
npm install --global yarn@1.22.22
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
```

Compile the application and an `.exe` installer:

```powershell
npm run build:windows
```

Or compile just the application `.exe`:

```powershell
npm run build:exe
```

Both commands discover Visual Studio **2026 (version 18)** using `vswhere`, activate
its x64 C++ environment, install the locked JavaScript dependencies and compile
the frontend and Rust application in release mode. They use the MSVC Rust
toolchain and keep build outputs inside `src-tauri/target`, even when
`CARGO_TARGET_DIR` is set in your terminal.

| Output | Location |
| --- | --- |
| Application | `src-tauri/target/x86_64-pc-windows-msvc/release/ispliced.exe` |
| Installer | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe` |

The application executable requires WebView2 on the destination computer. Use
the NSIS installer for distribution; it handles WebView2 installation when
needed. Initial builds need Internet access for dependencies and installer
tools. Builds are unsigned unless you configure Windows code signing.

If the launcher cannot find Visual Studio, repair or enable the C++ workload in
Visual Studio Installer. If Rust cannot locate the compiler/linker, update the
MSVC toolchain with the `rustup toolchain install` command above and retry.

### Build on GitHub instead

Once these changes are pushed, open **Actions → Windows executable → Run
workflow** and select your branch. After it succeeds, download
**Ispliced-windows-x64-exe** or **Ispliced-windows-x64-installer** from the run's
artifacts and extract the ZIP. This build uses the hosted Windows runner's C++
toolchain; it does not require Visual Studio on your computer and does not
publish a release.
