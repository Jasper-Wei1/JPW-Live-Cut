#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapPythonCandidates,
  isWindows,
  qwenRuntimeDirectory,
  qwenVenvCommand,
  qwenVenvPython,
} from "./qwen-runtime-paths.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const repoRoot = resolve(experimentDir, "../..");
const runtimeDir = qwenRuntimeDirectory(repoRoot);
await ensureWindowsRuntimeAlias();
const venvDir = join(runtimeDir, ".venv");
const python = qwenVenvPython(venvDir);
const cacheDir = join(runtimeDir, "缓存");
const modelsDir = join(cacheDir, "模型");
const asrModelDir = join(modelsDir, "Qwen3-ASR-0.6B");
const alignerModelDir = join(modelsDir, "Qwen3-ForcedAligner-0.6B");
const requirements = join(experimentDir, "requirements.txt");
const runtimePins = JSON.parse(
  await readFile(join(experimentDir, "runtime-pins.json"), "utf8"),
);
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`用法：npm run qwen:setup

创建独立 Python 环境并下载官方 Qwen 模型到：
  ${toRepoPath(cacheDir)}

该步骤只下载模型和 Python 依赖，不会读取或上传任何音频。`);
  process.exit(0);
}
if (args.size > 0) throw new Error(`未知参数：${[...args].join(" ")}`);

await mkdir(modelsDir, { recursive: true });

if (!(await exists(python))) {
  const bootstrapPython = await findBootstrapPython();
  await assertPython(bootstrapPython);
  await run(bootstrapPython, ["-m", "venv", venvDir]);
} else {
  await assertPython(python);
}

await run(python, ["-m", "pip", "install", "--upgrade", "pip"]);
await run(python, [
  "-m",
  "pip",
  "install",
  `torch==${runtimePins.pythonPackages.torch}`,
  `torchaudio==${runtimePins.pythonPackages.torchaudio}`,
]);
await run(python, ["-m", "pip", "install", "-r", requirements]);

await downloadModel(runtimePins.models.asr, asrModelDir);
await downloadModel(runtimePins.models.forcedAligner, alignerModelDir);

console.log("独立 Qwen 实验环境已就绪。");
console.log(`ASR 模型：${toRepoPath(asrModelDir)}`);
console.log(`对齐模型：${toRepoPath(alignerModelDir)}`);

async function assertPython(command) {
  const version = await output(command, [
    "-c",
    "import sys; print('.'.join(map(str, sys.version_info[:2])))",
  ]);
  const [major, minor] = version.trim().split(".").map(Number);
  if (major !== 3 || minor < 10) {
    throw new Error(
      `Qwen 实验需要 Python 3.10+；官方推荐 Python 3.12，当前为 ${version.trim()}。`,
    );
  }
  console.log(`使用隔离环境基底 Python ${version.trim()}：${command}`);
}

async function findBootstrapPython() {
  if (process.env.QWEN_EXPERIMENT_PYTHON)
    return process.env.QWEN_EXPERIMENT_PYTHON;
  const bundledPython = resolve(
    dirname(process.execPath),
    "../../python/bin/python3",
  );
  for (const candidate of bootstrapPythonCandidates({ bundledPython })) {
    try {
      const version = await output(candidate, [
        "-c",
        "import sys; print('.'.join(map(str, sys.version_info[:2])))",
      ]);
      const [major, minor] = version.trim().split(".").map(Number);
      if (major === 3 && minor >= 10) return candidate;
    } catch {
      // Try the next local Python candidate. No downloads happen here.
    }
  }
  throw new Error(
    "找不到 Python 3.10+。安装 Python 3.12 后重试，或设置 QWEN_EXPERIMENT_PYTHON 指向本地 Python 解释器。",
  );
}

async function ensureWindowsRuntimeAlias() {
  if (!isWindows() || runtimeDir === experimentDir) return;
  await mkdir(dirname(runtimeDir), { recursive: true });
  try {
    const entry = await lstat(runtimeDir);
    if (!entry.isSymbolicLink()) {
      throw new Error(`Windows Qwen 运行时目录必须是链接：${runtimeDir}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await symlink(experimentDir, runtimeDir, "junction");
  }
}

async function downloadModel(model, destination) {
  const { id: modelId, revision } = model;
  await mkdir(destination, { recursive: true });
  console.log(
    `同步官方模型 ${modelId}@${revision} 到 ${toRepoPath(destination)}`,
  );
  await run(
    qwenVenvCommand(venvDir, "modelscope"),
    [
      "download",
      "--model",
      modelId,
      "--revision",
      revision,
      "--local_dir",
      destination,
    ],
    {
      MODELSCOPE_CACHE: cacheDir,
      HF_HOME: join(cacheDir, "huggingface"),
    },
  );
  if (!(await exists(join(destination, "config.json")))) {
    throw new Error(`模型下载未产生 config.json：${toRepoPath(destination)}`);
  }
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

function output(command, commandArgs) {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(command, commandArgs, { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectOutput);
    child.on("exit", (code) => {
      if (code === 0) resolveOutput(stdout);
      else
        rejectOutput(
          new Error(`${command} exited with code ${code}: ${stderr}`),
        );
    });
  });
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

function toRepoPath(path) {
  return relative(repoRoot, path).split("\\").join("/");
}
