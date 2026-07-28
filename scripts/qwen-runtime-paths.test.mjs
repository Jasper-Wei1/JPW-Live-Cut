import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  bootstrapPythonCandidates,
  joinPythonPath,
  qwenRuntimeDirectory,
  qwenVenvCommand,
  qwenVenvPython,
  remotionInvocation,
} from "../实验/qwen-asr/scripts/qwen-runtime-paths.mjs";

test("Qwen 虚拟环境路径在 Unix 使用 bin", () => {
  assert.equal(qwenVenvPython("runtime", "darwin"), join("runtime", "bin", "python"));
  assert.equal(qwenVenvCommand("runtime", "modelscope", "linux"), join("runtime", "bin", "modelscope"));
  assert.equal(joinPythonPath(["one", "two"], "linux"), "one:two");
});

test("Qwen 虚拟环境路径在 Windows 使用 Scripts 和 exe", () => {
  assert.equal(qwenVenvPython("runtime", "win32"), join("runtime", "Scripts", "python.exe"));
  assert.equal(qwenVenvCommand("runtime", "modelscope", "win32"), join("runtime", "Scripts", "modelscope.exe"));
  assert.equal(joinPythonPath(["one", "two"], "win32"), "one;two");
  assert.deepEqual(bootstrapPythonCandidates({ platform: "win32" }), ["py", "python"]);
  assert.equal(qwenRuntimeDirectory("repo", "win32"), join("repo", ".jpw-cache", "qwen-asr"));
  assert.equal(qwenRuntimeDirectory("repo", "darwin"), join("repo", "实验", "qwen-asr"));
});

test("Remotion CLI 通过 Node 直接启动，避免 Windows shell shim", () => {
  const invocation = remotionInvocation("engine", ["ffprobe", "input.mp4"]);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(-2), ["ffprobe", "input.mp4"]);
  assert.equal(invocation.args[0], join("engine", "node_modules", "@remotion", "cli", "remotion-cli.js"));
});
