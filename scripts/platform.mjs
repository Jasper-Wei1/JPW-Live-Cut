import { join } from "node:path";
import { availableParallelism, totalmem } from "node:os";

export const isWindows = (platform = process.platform) => platform === "win32";

export const whisperExecutableName = (platform = process.platform) =>
  isWindows(platform) ? "main.exe" : "main";

// The Windows Whisper.cpp 1.5.5 binary can emit corrupt Chinese DTW tokens.
export const usesWhisperTokenTimestamps = (platform = process.platform) =>
  !isWindows(platform);

export const whisperDirectory = (root) =>
  join(root, ".jpw-cache", "whisper.cpp");

export const remotionCliPath = (remotionDir) =>
  join(remotionDir, "node_modules", "@remotion", "cli", "remotion-cli.js");

// Running the JavaScript entry point directly avoids .cmd execution differences.
export const remotionInvocation = (remotionDir, args) => ({
  command: process.execPath,
  args: [remotionCliPath(remotionDir), ...args],
});

export const requiredPlatformTools = (platform = process.platform) =>
  isWindows(platform) ? ["powershell.exe"] : ["make"];

export const commandLocator = (platform = process.platform) =>
  isWindows(platform) ? "where.exe" : "which";

const GIB = 1024 ** 3;

export const runtimeTuning = ({
  availableProcessors = availableParallelism(),
  memoryBytes = totalmem(),
} = {}) => {
  const processors = Math.max(1, Math.floor(availableProcessors));
  const memoryGiB = Math.max(1, memoryBytes / GIB);
  const reservedProcessors = processors >= 8 ? 2 : 1;
  const usableProcessors = Math.max(1, processors - reservedProcessors);
  const whisperMemoryLimit =
    memoryGiB < 12 ? 4 : memoryGiB < 24 ? 6 : usableProcessors;

  return {
    availableProcessors: processors,
    memoryGiB: Math.round(memoryGiB * 10) / 10,
    whisperThreads: Math.min(usableProcessors, whisperMemoryLimit),
    renderConcurrency: Math.min(
      usableProcessors,
      Math.max(1, Math.round(memoryGiB / 4)),
    ),
    hardwareAcceleration: "if-possible",
  };
};
