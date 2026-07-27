#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const repoRoot = resolve(experimentDir, "../..");
const remotionDir = join(repoRoot, "引擎", "remotion");
const python = join(experimentDir, ".venv", "bin", "python");
const runner = join(scriptDir, "run_local_qwen_asr.py");
const cacheDir = join(experimentDir, "缓存");
const modelsDir = join(cacheDir, "模型");
const resultRoot = join(experimentDir, "结果");
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}
if (/^(https?:|data:)/iu.test(args.input)) {
  throw new Error("Qwen 实验只接受仓库内的本地媒体路径，拒绝 URL 或 data URL。 ");
}
if (!(await exists(python))) {
  throw new Error("Qwen 实验环境未安装。先运行 npm run qwen:setup。 ");
}

const inputPath = resolve(repoRoot, args.input);
await access(inputPath, constants.R_OK);
assertInsideRepo(inputPath, "输入媒体");
const name = sanitizeName(args.name || basename(inputPath, extname(inputPath)));
const outputDir = join(resultRoot, name);
const wavPath = join(outputDir, "source-16k-mono.wav");
const sourceStat = await stat(inputPath);

if (await exists(outputDir) && !args.force) {
  throw new Error(`实验结果目录已存在：${toRepoPath(outputDir)}。确认允许覆盖后使用 --force。`);
}
if (args.force) await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const startedAt = new Date().toISOString();
const startedNs = process.hrtime.bigint();
try {
  await extractAudio(inputPath, wavPath);
  await run(python, [
    runner,
    "--audio",
    wavPath,
    "--output-dir",
    outputDir,
    "--source",
    toRepoPath(inputPath),
    "--source-size-bytes",
    String(sourceStat.size),
    "--media-duration-ms",
    String(args.mediaDurationMs),
    "--chunk-seconds",
    String(args.chunkSeconds),
    "--asr-model-dir",
    join(modelsDir, "Qwen3-ASR-0.6B"),
    "--aligner-model-dir",
    join(modelsDir, "Qwen3-ForcedAligner-0.6B"),
  ], offlineEnvironment());
} catch (error) {
  const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
  await writeFailure(outputDir, { startedAt, elapsedMs, error });
  throw error;
}

console.log(`Qwen 实验结果：${toRepoPath(outputDir)}`);

function parseArgs(argv) {
  const parsed = {
    input: null,
    name: null,
    mediaDurationMs: 3304640,
    chunkSeconds: 240,
    force: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") parsed.input = argv[++index];
    else if (arg === "--name") parsed.name = argv[++index];
    else if (arg === "--media-duration-ms") parsed.mediaDurationMs = Number(argv[++index]);
    else if (arg === "--chunk-seconds") parsed.chunkSeconds = Number(argv[++index]);
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isInteger(parsed.mediaDurationMs) || parsed.mediaDurationMs <= 0) {
    throw new Error("--media-duration-ms 必须是正整数。 ");
  }
  if (!Number.isInteger(parsed.chunkSeconds) || parsed.chunkSeconds <= 0 || parsed.chunkSeconds > 240) {
    throw new Error("--chunk-seconds 必须是 1-240 的整数。 ");
  }
  return parsed;
}

function printHelp() {
  console.log(`用法：npm run qwen:transcribe -- --input <本地媒体> --name <实验名> [选项]

选项：
  --media-duration-ms <毫秒>  媒体真源时长，默认 3304640
  --chunk-seconds <1-240>      ForcedAligner 分段秒数，默认 240
  --force                      仅覆盖同名实验结果目录

示例：
  npm run qwen:transcribe -- --input "引擎/remotion/public/generated/livestream-clips/2026-07-17-直播回放/source.MP4" --name "2026-07-17-直播回放-qwen-ab"`);
}

async function extractAudio(input, output) {
  const remotion = join(remotionDir, "node_modules/.bin/remotion");
  await run(remotion, [
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

function offlineEnvironment() {
  return {
    HF_HOME: join(cacheDir, "huggingface"),
    MODELSCOPE_CACHE: cacheDir,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    MODELSCOPE_OFFLINE: "1",
    NO_PROXY: "*",
  };
}

function run(command, commandArgs, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function writeFailure(outputDir, { startedAt, elapsedMs, error }) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(outputDir, "failure.json"),
    `${JSON.stringify({
      status: "failed",
      startedAt,
      elapsedMs: Math.round(elapsedMs),
      error: String(error?.stack || error),
      audioLocalOnly: true,
      networkDisabledDuringTranscription: true,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function assertInsideRepo(path, label) {
  const candidate = relative(repoRoot, path);
  if (candidate.startsWith("..") || candidate === "") {
    throw new Error(`${label}必须位于仓库内。`);
  }
}

function sanitizeName(value) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function toRepoPath(path) {
  return relative(repoRoot, path).split("\\").join("/");
}
