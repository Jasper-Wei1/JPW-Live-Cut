#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { qwenVenvPython, remotionInvocation } from "../实验/qwen-asr/scripts/qwen-runtime-paths.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const experimentDir = join(repoRoot, "实验", "qwen-asr");
const remotionDir = join(repoRoot, "引擎", "remotion");
const python = qwenVenvPython(join(experimentDir, ".venv"));
const runner = join(experimentDir, "scripts", "run_local_qwen_asr.py");
const cacheDir = join(experimentDir, "缓存");
const modelsDir = join(cacheDir, "模型");
const defaultOutputDir = join(repoRoot, "工作区", "数据", "草稿");
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}
if (/^(https?:|data:)/iu.test(args.input)) {
  throw new Error("正式 Qwen 转录只接受仓库内本地媒体路径。 ");
}
if (!(await exists(python))) {
  throw new Error("Qwen 默认环境未安装。先运行 npm run setup。 ");
}

const inputPath = resolve(repoRoot, args.input);
const outputDir = resolve(repoRoot, args.outputDir || defaultOutputDir);
assertInsideRepo(inputPath, "输入媒体");
assertInsideRepo(outputDir, "输出目录");
await access(inputPath, constants.R_OK);
const name = sanitizeName(args.name || basename(inputPath, extname(inputPath)));
const normalizedPath = join(outputDir, `${name}-transcript.json`);
const rawPath = join(outputDir, `${name}-transcript.qwen.raw.json`);
const metricsPath = join(outputDir, `${name}-transcript.qwen.metrics.json`);

if (!args.force) {
  for (const path of [normalizedPath, rawPath, metricsPath]) {
    if (await exists(path)) {
      throw new Error(`输出文件已存在：${toRepoPath(path)}。确认允许覆盖后使用 --force。`);
    }
  }
}
await mkdir(outputDir, { recursive: true });
const sourceStat = await stat(inputPath);
const workDir = await mkdtemp(join(tmpdir(), "local-qwen-asr-"));

try {
  const wavPath = join(workDir, "source-16k-mono.wav");
  const mediaDurationMs = await probeMediaDuration(inputPath);
  await extractAudio(inputPath, wavPath);
  await run(python, [
    runner,
    "--audio", wavPath,
    "--output-dir", outputDir,
    "--source", toRepoPath(inputPath),
    "--source-size-bytes", String(sourceStat.size),
    "--media-duration-ms", String(mediaDurationMs),
    "--chunk-seconds", String(args.chunkSeconds),
    "--asr-model-dir", join(modelsDir, "Qwen3-ASR-0.6B"),
    "--aligner-model-dir", join(modelsDir, "Qwen3-ForcedAligner-0.6B"),
    "--normalized-output-name", `${name}-transcript.json`,
    "--raw-output-name", `${name}-transcript.qwen.raw.json`,
    "--metrics-output-name", `${name}-transcript.qwen.metrics.json`,
  ], offlineEnvironment());
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log(`本地 Qwen 原始结果：${toRepoPath(rawPath)}`);
console.log(`标准化逐字稿：${toRepoPath(normalizedPath)}`);
console.log(`性能记录：${toRepoPath(metricsPath)}`);

function parseArgs(argv) {
  const parsed = { input: null, outputDir: null, name: null, chunkSeconds: 120, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") parsed.input = argv[++index];
    else if (arg === "--output-dir") parsed.outputDir = argv[++index];
    else if (arg === "--name") parsed.name = argv[++index];
    else if (arg === "--chunk-seconds") parsed.chunkSeconds = Number(argv[++index]);
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isInteger(parsed.chunkSeconds) || parsed.chunkSeconds < 1 || parsed.chunkSeconds > 240) {
    throw new Error("--chunk-seconds 必须是 1-240 的整数。 ");
  }
  return parsed;
}

function printHelp() {
  console.log(`用法：npm run transcribe -- --input <media> [--name <name>]

默认使用本地 Qwen3-ASR-0.6B + Qwen3-ForcedAligner-0.6B，并输出兼容
schemaVersion 1 的逐字稿到 工作区/数据/草稿。

参数：
  --output-dir <dir>      覆盖默认输出目录 工作区/数据/草稿
  --chunk-seconds <1-240> 对齐分段秒数，默认 120
  --force                 覆盖同名 Qwen 输出

Whisper.cpp 回退：npm run whisper:transcribe -- --input <media> --name <name>`);
}

async function extractAudio(input, output) {
  const invocation = remotionInvocation(remotionDir, [
    "ffmpeg", "-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output,
  ]);
  await run(invocation.command, invocation.args);
}

async function probeMediaDuration(input) {
  const invocation = remotionInvocation(remotionDir, [
    "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", input,
  ]);
  const output = await runCapture(invocation.command, invocation.args);
  const durationMs = Math.round(Number(JSON.parse(output).format?.duration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("无法确定原片时长，不能启动 Qwen 转录。");
  }
  return durationMs;
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
    const child = spawn(command, commandArgs, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with code ${code}`))));
  });
}

function runCapture(command, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, { cwd: repoRoot });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(`${command} exited with code ${code}: ${errors}`));
    });
  });
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function assertInsideRepo(path, label) {
  const candidate = relative(repoRoot, path);
  if (candidate.startsWith("..") || candidate === "") throw new Error(`${label}必须位于仓库内。`);
}

function sanitizeName(value) { return value.replace(/[\\/:*?"<>|]/g, "-").trim(); }
function toRepoPath(path) { return relative(repoRoot, path).split("\\").join("/"); }
