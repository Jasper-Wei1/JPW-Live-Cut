import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { remotionInvocation, runtimeTuning } from "./platform.mjs";

test("Remotion CLI uses the Node entry point", () => {
  const remotionDir = join("workspace", "engine");
  const invocation = remotionInvocation(remotionDir, ["ffmpeg", "-version"]);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    join(
      remotionDir,
      "node_modules",
      "@remotion",
      "cli",
      "remotion-cli.js",
    ),
    "ffmpeg",
    "-version",
  ]);
});

test("Runtime tuning derives render concurrency from processors and memory", () => {
  assert.deepEqual(
    runtimeTuning({
      availableProcessors: 12,
      memoryBytes: 32 * 1024 ** 3,
    }),
    {
      availableProcessors: 12,
      memoryGiB: 32,
      renderConcurrency: 8,
      hardwareAcceleration: "if-possible",
    },
  );
  assert.deepEqual(
    runtimeTuning({
      availableProcessors: 4,
      memoryBytes: 8 * 1024 ** 3,
    }),
    {
      availableProcessors: 4,
      memoryGiB: 8,
      renderConcurrency: 2,
      hardwareAcceleration: "if-possible",
    },
  );
});
