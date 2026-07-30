import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("Qwen runtime pins direct packages and immutable model revisions", async () => {
  const pins = JSON.parse(
    await readFile(resolve(root, "实验/qwen-asr/runtime-pins.json"), "utf8"),
  );
  const requirements = await readFile(
    resolve(root, "实验/qwen-asr/requirements.txt"),
    "utf8",
  );
  const setupSource = await readFile(
    resolve(root, "实验/qwen-asr/scripts/setup-local-qwen.mjs"),
    "utf8",
  );

  assert.equal(pins.schemaVersion, 1);
  assert.match(pins.pythonPackages.torch, /^\d+\.\d+\.\d+$/u);
  assert.match(pins.pythonPackages.torchaudio, /^\d+\.\d+\.\d+$/u);
  assert.match(requirements, /^qwen-asr==\d+\.\d+\.\d+$/mu);
  assert.match(requirements, /^modelscope==\d+\.\d+\.\d+$/mu);
  for (const model of Object.values(pins.models)) {
    assert.match(model.id, /^Qwen\/Qwen3-/u);
    assert.match(model.revision, /^[0-9a-f]{40}$/u);
    assert.equal(model.license, "Apache-2.0");
  }
  assert.match(setupSource, /"--revision",\s+revision/u);
});
