import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("默认转录入口使用本地 Qwen，并保留 Whisper 显式回退", async () => {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts.transcribe, "node scripts/transcribe-qwen-default.mjs");
  assert.equal(manifest.scripts["whisper:transcribe"], "node 引擎/remotion/scripts/transcribe-local.mjs");
});

test("默认 Qwen 包装器生成旧消费端兼容的标准输出名", async () => {
  const source = await readFile(resolve(root, "scripts/transcribe-qwen-default.mjs"), "utf8");
  assert.match(source, /\$\{name\}-transcript\.json/);
  assert.match(source, /--normalized-output-name/);
  assert.match(source, /HF_HUB_OFFLINE: "1"/);
  assert.match(source, /"ffprobe"/);
  assert.match(source, /--media-duration-ms", String\(mediaDurationMs\)/);
});
