import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";

export const remotionCliPath = (remotionDir) =>
  join(remotionDir, "node_modules", "@remotion", "cli", "remotion-cli.js");

// Running the JavaScript entry point directly avoids .cmd execution differences.
export const remotionInvocation = (remotionDir, args) => ({
  command: process.execPath,
  args: [remotionCliPath(remotionDir), ...args],
});

const GIB = 1024 ** 3;

export const runtimeTuning = ({
  availableProcessors = availableParallelism(),
  memoryBytes = totalmem(),
} = {}) => {
  const processors = Math.max(1, Math.floor(availableProcessors));
  const memoryGiB = Math.max(1, memoryBytes / GIB);
  const reservedProcessors = processors >= 8 ? 2 : 1;
  const usableProcessors = Math.max(1, processors - reservedProcessors);
  return {
    availableProcessors: processors,
    memoryGiB: Math.round(memoryGiB * 10) / 10,
    renderConcurrency: Math.min(
      usableProcessors,
      Math.max(1, Math.round(memoryGiB / 4)),
    ),
    hardwareAcceleration: "if-possible",
  };
};
