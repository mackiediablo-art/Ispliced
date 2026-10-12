import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
export const target = "x86_64-pc-windows-msvc";

export function buildCommand(visualStudio, exeOnly = false) {
  // cmd expands percent signs even within quotes; reject ambiguous installation paths.
  if (/["%\r\n]/.test(visualStudio)) throw new Error("Unsupported Visual Studio installation path.");
  const vcvars = path.win32.join(visualStudio, "VC", "Auxiliary", "Build", "vcvarsall.bat");
  const bundle = exeOnly ? "--no-bundle" : "--bundles nsis";
  return `call "${vcvars}" x64 && yarn install --frozen-lockfile --non-interactive && yarn tauri build --ci --target ${target} ${bundle}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, ...options });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? "unknown"}).`);
  return result.stdout?.trim();
}

export function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log("Windows x64 / Visual Studio 2026 builds:\n  yarn build:windows  Application exe + NSIS setup.exe\n  yarn build:exe      Application exe only\nSee README.md for prerequisites and output paths.");
    return;
  }
  if (args.some(arg => arg !== "--exe-only")) throw new Error("Unknown option. Use --exe-only or --help.");
  if (process.platform !== "win32") throw new Error("Run this build on Windows with Visual Studio 2026, or use the Windows executable GitHub Actions workflow.");

  const programFiles = process.env["ProgramFiles(x86)"] || process.env.ProgramFiles;
  const vswhere = programFiles && path.join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!vswhere || !existsSync(vswhere)) throw new Error("Visual Studio Installer was not found. Install Visual Studio 2026 with Desktop development with C++.");
  const visualStudio = run(vswhere, ["-latest", "-products", "*", "-version", "[18.0,19.0)",
    "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" });
  if (!visualStudio) throw new Error("Visual Studio 2026 C++ tools were not found. In Visual Studio Installer, select Desktop development with C++ and the Windows SDK.");
  if (!existsSync(path.join(visualStudio, "VC", "Auxiliary", "Build", "vcvarsall.bat"))) throw new Error("Visual Studio C++ environment script is missing. Repair the C++ workload in Visual Studio Installer.");

  try {
    run("rustup", ["run", "stable-x86_64-pc-windows-msvc", "rustc", "--version"], { stdio: "inherit" });
  } catch {
    throw new Error("Install or update Rust MSVC first: rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal");
  }
  const exeOnly = args.includes("--exe-only");
  console.log(`Using Visual Studio 2026: ${visualStudio}`);
  run("cmd.exe", ["/d", "/s", "/c", buildCommand(visualStudio, exeOnly)], {
    windowsVerbatimArguments: true,
    stdio: "inherit",
    env: { ...process.env, RUSTUP_TOOLCHAIN: "stable-x86_64-pc-windows-msvc",
      CARGO_TARGET_DIR: path.join(root, "src-tauri", "target") },
  });
  const release = path.join(root, "src-tauri", "target", target, "release");
  const exe = path.join(release, "ispliced.exe");
  if (!existsSync(exe)) throw new Error(`Build finished but the application executable was not found: ${exe}`);
  console.log(`Application: ${exe}`);
  if (!exeOnly) {
    const directory = path.join(release, "bundle", "nsis");
    const installers = existsSync(directory) ? readdirSync(directory).filter(file => file.endsWith("-setup.exe")) : [];
    if (!installers.length) throw new Error(`No Windows setup executable was produced in ${directory}`);
    for (const installer of installers) console.log(`Installer: ${path.join(directory, installer)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
