#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinPythonPath, qwenVenvPython } from "./qwen-runtime-paths.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const repoRoot = resolve(experimentDir, "../..");
const python = qwenVenvPython(join(experimentDir, ".venv"));

try {
  await access(python, constants.X_OK);
} catch {
  throw new Error("Qwen 实验环境未安装。先运行 npm run qwen:setup。 ");
}

await new Promise((resolveRun, rejectRun) => {
  const child = spawn(python, ["-m", "unittest", "discover", "-s", "实验/qwen-asr/tests"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: joinPythonPath([join(experimentDir, "scripts"), process.env.PYTHONPATH]),
    },
    stdio: "inherit",
  });
  child.on("error", rejectRun);
  child.on("exit", (code) => {
    if (code === 0) resolveRun();
    else rejectRun(new Error(`Qwen tests exited with code ${code}`));
  });
});
