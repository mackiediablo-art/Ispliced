import { describe, expect, it } from "vitest";
import { buildCommand, main } from "../scripts/build-windows.mjs";

describe("Windows build launcher", () => {
  it("activates VS 2026 paths with spaces and builds the x64 executable installer", () => {
    const command = buildCommand("C:\\Program Files\\Microsoft Visual Studio\\18\\Community");
    expect(command).toContain('call "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat" x64');
    expect(command).toContain("yarn install --frozen-lockfile --non-interactive && yarn tauri build");
    expect(command).toContain("--target x86_64-pc-windows-msvc --bundles nsis");
  });
  it("can compile just the application executable", () => {
    expect(buildCommand("C:\\VS2026", true)).toContain("--no-bundle");
    expect(buildCommand("C:\\VS2026", true)).not.toContain("--bundles");
  });
  it("rejects paths cmd could expand or break out of", () => {
    for (const directory of ['C:\\VS"&echo bad', "C:\\%BAD%", "C:\\VS\n"]) {
      expect(() => buildCommand(directory)).toThrow("Unsupported Visual Studio installation path");
    }
  });
  it.skipIf(process.platform === "win32")("explains the Windows requirement on other hosts", () => {
    expect(() => main([])).toThrow("Run this build on Windows");
  });
});
