import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("Default transcription uses only local Qwen", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts.transcribe, "node scripts/transcribe-qwen-default.mjs");
  assert.equal(manifest.scripts["whisper:setup"], undefined);
  assert.equal(manifest.scripts["whisper:transcribe"], undefined);
  assert.equal(manifest.scripts["qwen:report"], undefined);
});

test("Default Qwen wrapper keeps duration validation and local execution", async () => {
  const source = await readFile(resolve(root, "scripts/transcribe-qwen-default.mjs"), "utf8");
  assert.match(source, /\$\{name\}-transcript\.json/);
  assert.match(source, /--normalized-output-name/);
  assert.match(source, /HF_HUB_OFFLINE: "1"/);
  assert.match(source, /"ffprobe"/);
  assert.match(source, /--media-duration-ms", String\(mediaDurationMs\)/);
  assert.match(source, /qwenVenvPython/);
  assert.match(source, /remotionInvocation/);
  assert.doesNotMatch(source, /node_modules\/\.bin\/remotion/);
  assert.doesNotMatch(source, /Whisper/u);
});
