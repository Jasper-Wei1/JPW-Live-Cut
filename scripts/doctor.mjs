#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checks = [];

const add = (name, ok, detail) => checks.push({ name, ok, detail });
const nodeMajor = Number(process.versions.node.split(".")[0]);
const qwenPythonPath = join(root, "实验/qwen-asr/.venv/bin/python");
const qwenPython = pythonVersion(qwenPythonPath);
const systemPython = pythonVersion("python3");

add("Node.js 20+", nodeMajor >= 20, process.version);
add(
  "Qwen 默认平台",
  process.platform === "darwin",
  process.platform === "darwin" ? "macOS (MPS)" : "当前 Qwen 默认流程只验证 macOS",
);
if (qwenPython) {
  add(
    "本地 Qwen 环境 (Python 3.10+)",
    qwenPython.major === 3 && qwenPython.minor >= 10,
    qwenPython.text,
  );
} else {
  add(
    "Python 3.10+（首次安装需要）",
    systemPython?.major === 3 && systemPython.minor >= 10,
    systemPython?.text || "可通过 QWEN_EXPERIMENT_PYTHON 指定本地解释器",
  );
}
add(
  "Remotion 工程",
  existsSync(join(root, "引擎/remotion/package.json")),
  "引擎/remotion/package.json",
);
add(
  "项目依赖",
  existsSync(join(root, "引擎/remotion/node_modules/.bin/remotion")),
  "缺失时运行 npm run setup",
);
add(
  "Qwen3-ASR-0.6B",
  existsSync(join(root, "实验/qwen-asr/缓存/模型/Qwen3-ASR-0.6B/config.json")),
  "本地模型",
);
add(
  "Qwen3-ForcedAligner-0.6B",
  existsSync(join(root, "实验/qwen-asr/缓存/模型/Qwen3-ForcedAligner-0.6B/config.json")),
  "本地模型",
);
add(
  "直播原片输入目录",
  existsSync(join(root, "输入/媒体素材/直播录像")),
  "输入/媒体素材/直播录像/",
);

for (const check of checks) {
  console.log(`${check.ok ? "正常" : "缺失"}  ${check.name} - ${check.detail}`);
}

function pythonVersion(command) {
  const result = spawnSync(command, ["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), text: `python3 ${text}` };
}

if (checks.some((check) => !check.ok)) {
  console.error("\n环境尚未就绪。请按照 README.md 运行 npm run setup。");
  process.exitCode = 1;
} else {
  console.log("\n环境检查通过。");
}
