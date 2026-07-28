import { join } from "node:path";

export const isWindows = (platform = process.platform) => platform === "win32";

export function qwenRuntimeDirectory(repoRoot, platform = process.platform) {
  return isWindows(platform)
    ? join(repoRoot, ".jpw-cache", "qwen-asr")
    : join(repoRoot, "实验", "qwen-asr");
}

export function qwenVenvPython(venvDir, platform = process.platform) {
  return join(
    venvDir,
    isWindows(platform) ? "Scripts" : "bin",
    isWindows(platform) ? "python.exe" : "python",
  );
}

export function qwenVenvCommand(venvDir, command, platform = process.platform) {
  return join(
    venvDir,
    isWindows(platform) ? "Scripts" : "bin",
    `${command}${isWindows(platform) ? ".exe" : ""}`,
  );
}

export function bootstrapPythonCandidates({
  platform = process.platform,
  bundledPython,
} = {}) {
  if (isWindows(platform)) return ["py", "python"];
  return [
    bundledPython,
    "python3.12",
    "/opt/homebrew/opt/python@3.12/bin/python3.12",
    "python3",
  ].filter(Boolean);
}

export function joinPythonPath(paths, platform = process.platform) {
  return paths.filter(Boolean).join(isWindows(platform) ? ";" : ":");
}

// Calling the installed CLI through Node avoids POSIX-only .bin shims on Windows.
export function remotionInvocation(remotionDir, args) {
  return {
    command: process.execPath,
    args: [
      join(remotionDir, "node_modules", "@remotion", "cli", "remotion-cli.js"),
      ...args,
    ],
  };
}
