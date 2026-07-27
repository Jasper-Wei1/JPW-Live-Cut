#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const experimentDir = resolve(scriptDir, "..");
const repoRoot = resolve(experimentDir, "../..");
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.qwen || !args.approvedPlan || !args.output) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const qwen = await readJson(args.qwen);
const plan = await readJson(args.approvedPlan);
const metrics = args.metrics ? await readJson(args.metrics) : null;
if (qwen.schemaVersion !== 1 || !Array.isArray(qwen.characters)) {
  throw new Error("Qwen 逐字稿必须是 schemaVersion 1 且含 characters。 ");
}
if (plan.workflow !== "clip-extraction-review" || !Array.isArray(plan.candidates)) {
  throw new Error("已批准切片方案无效。 ");
}

const clips = [];
for (const candidate of plan.candidates) {
  if (candidate.reviewStatus !== "approved") continue;
  const reviewedPath = resolve(
    repoRoot,
    `工作区/数据/已确认/${plan.id}-${candidate.id}-reviewed-transcript.json`,
  );
  const whisper = await readJson(reviewedPath);
  const qwenCharacters = qwen.characters.filter(
    (item) => item.startMs >= candidate.sourceStartMs && item.endMs <= candidate.sourceEndMs,
  );
  const qwenText = qwenCharacters.map(({ character }) => character).join("");
  const whisperText = String(whisper.text ?? "");
  const hunks = createDiffHunks(whisperText, qwenText);
  const lcsLength = longestCommonSubsequenceLength([...whisperText], [...qwenText]);
  clips.push({
    id: candidate.id,
    sourceStartMs: candidate.sourceStartMs,
    sourceEndMs: candidate.sourceEndMs,
    durationMs: candidate.durationMs,
    whisperPath: toRepoPath(reviewedPath),
    qwenCharacterCount: qwenCharacters.length,
    qwenText,
    whisperText,
    characterAgreementPercent: percent(lcsLength, Math.max(whisperText.length, qwenText.length)),
    hunks,
    qwenCharacters,
  });
}
if (clips.length !== 5) {
  throw new Error(`预期 5 条已批准切片，实际读取到 ${clips.length} 条。`);
}

const samples = sampleBoundaries(clips, 30).map((sample, index) => ({
  id: `boundary-${String(index + 1).padStart(2, "0")}`,
  clipId: sample.clipId,
  character: sample.character,
  sourceStartMs: sample.startMs,
  sourceEndMs: sample.endMs,
  sourceTimecode: formatTimecode(sample.startMs),
  timestampSource: sample.timestampSource,
  timestampPrecision: sample.timestampPrecision,
  pointTimestamp: Boolean(sample.pointTimestamp),
  reviewStatus: "pending-human-audio-review",
  passThresholdMs: 150,
}));

const pointTimestampCount = qwen.qwenTimestampUnits?.filter((item) => item.pointTimestamp).length ?? 0;
const summary = {
  schemaVersion: 1,
  experiment: "qwen-asr-ab",
  qwenTranscript: toRepoPath(resolve(repoRoot, args.qwen)),
  whisperBaseline: "工作区/数据/草稿/2026-07-17-直播回放-transcript.json",
  approvedPlan: toRepoPath(resolve(repoRoot, args.approvedPlan)),
  source: qwen.source,
  sourceMedia: qwen.sourceMedia,
  timelineCoverage: qwen.timingCoverage?.audioChunks,
  performance: metrics?.performance ?? null,
  system: metrics?.system ?? null,
  pointTimestampCount,
  clips: clips.map(({ qwenCharacters, ...clip }) => clip),
  boundarySamples: samples,
  qualityGate: {
    sampleCount: samples.length,
    thresholdMs: 150,
    requiredPassPercent: 90,
    status: "pending-human-audio-review",
    reason: "Whisper timestamps are estimated; a text-to-text comparison cannot certify audio boundary error.",
  },
};

const outputPath = resolve(repoRoot, args.output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(`${outputPath}.json`, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(outputPath, renderMarkdown(summary), "utf8");
console.log(`A/B 报告：${toRepoPath(outputPath)}`);
console.log(`边界抽样：${toRepoPath(`${outputPath}.json`)}`);

function parseArgs(argv) {
  const parsed = { qwen: null, approvedPlan: null, output: null, metrics: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--qwen") parsed.qwen = argv[++index];
    else if (arg === "--approved-plan") parsed.approvedPlan = argv[++index];
    else if (arg === "--metrics") parsed.metrics = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`用法：npm run qwen:report -- --qwen <transcript.qwen.json> --approved-plan <approved-clips.json> --output <ab-report.md> [--metrics <run-metrics.json>]`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repoRoot, path), "utf8"));
}

function createDiffHunks(whisperText, qwenText) {
  const left = [...whisperText];
  const right = [...qwenText];
  const matrix = buildLcsMatrix(left, right);
  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({ kind: "equal", text: left[leftIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex < right.length && (leftIndex === left.length || matrix[leftIndex * (right.length + 1) + rightIndex + 1] >= matrix[(leftIndex + 1) * (right.length + 1) + rightIndex])) {
      operations.push({ kind: "qwen", text: right[rightIndex++] });
    } else {
      operations.push({ kind: "whisper", text: left[leftIndex++] });
    }
  }
  const hunks = [];
  let cursor = 0;
  for (let index = 0; index < operations.length;) {
    if (operations[index].kind === "equal") {
      cursor += operations[index++].text.length;
      continue;
    }
    const start = index;
    let whisperOnly = "";
    let qwenOnly = "";
    while (index < operations.length && operations[index].kind !== "equal") {
      if (operations[index].kind === "whisper") whisperOnly += operations[index].text;
      else qwenOnly += operations[index].text;
      index += 1;
    }
    hunks.push({
      context: left.slice(Math.max(0, cursor - 12), cursor).join("") + "[...]" + left.slice(cursor, cursor + 12).join(""),
      whisperOnly,
      qwenOnly,
    });
    cursor += operations.slice(start, index).filter((item) => item.kind === "whisper").length;
  }
  return hunks;
}

function buildLcsMatrix(left, right) {
  const width = right.length + 1;
  const matrix = new Uint16Array((left.length + 1) * width);
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex * width + rightIndex] = left[leftIndex] === right[rightIndex]
        ? matrix[(leftIndex + 1) * width + rightIndex + 1] + 1
        : Math.max(matrix[(leftIndex + 1) * width + rightIndex], matrix[leftIndex * width + rightIndex + 1]);
    }
  }
  return matrix;
}

function longestCommonSubsequenceLength(left, right) {
  return buildLcsMatrix(left, right)[0];
}

function sampleBoundaries(clips, wanted) {
  const candidates = clips.flatMap((clip) => clip.qwenCharacters.map((item) => ({ ...item, clipId: clip.id })));
  const samples = [];
  for (let index = 0; index < wanted; index += 1) {
    samples.push(candidates[Math.min(candidates.length - 1, Math.floor((index * candidates.length) / wanted))]);
  }
  return samples;
}

function renderMarkdown(report) {
  const lines = [
    "# Qwen / Whisper A/B 对照报告",
    "",
    "## 运行边界",
    "",
    "- Qwen 仅在本地运行，转录阶段禁用模型下载与网络访问。",
    `- 源媒体：\`${report.source}\`。`,
    `- 标准化时长：${report.sourceMedia.durationMs}ms；音频时长：${report.sourceMedia.audioDurationMs}ms；误差：${report.sourceMedia.durationErrorMs}ms。`,
    `- 音频分段覆盖率：${report.timelineCoverage.coveragePercent}%；缺口：${report.timelineCoverage.gaps.length}；重叠：${report.timelineCoverage.overlaps.length}。`,
    report.performance ? `- Qwen 转录和对齐：${report.performance.transcriptionAndAlignmentMs}ms，RTF ${report.performance.realTimeFactor}，小于媒体时长：${report.performance.withinMediaDuration}。` : "",
    `- Qwen ForcedAligner 点时间戳：${report.pointTimestampCount} 个，已以 1ms 非精确跨度兼容 schemaVersion 1，原始点值保留在 \`qwenTimestampUnits\`。`,
    "",
    "## 五条已批准切片",
    "",
  ];
  for (const clip of report.clips) {
    lines.push(`### ${clip.id} (${formatTimecode(clip.sourceStartMs)} - ${formatTimecode(clip.sourceEndMs)})`, "");
    lines.push(`- Whisper 逐字稿：\`${clip.whisperPath}\``);
    lines.push(`- 字符 LCS 一致率：${clip.characterAgreementPercent}%（仅作文字对照，不等同原音准确率）。`);
    lines.push(`- Qwen 原始时间戳字符数：${clip.qwenCharacterCount}。`, "");
    lines.push("Whisper：", "", "```text", clip.whisperText, "```", "", "Qwen：", "", "```text", clip.qwenText, "```");
    lines.push("", "差异：", "", "| 附近 Whisper 上下文 | Whisper 独有 | Qwen 独有 |", "| --- | --- | --- |");
    for (const hunk of clip.hunks) lines.push(`| ${escapeTable(hunk.context)} | ${escapeTable(hunk.whisperOnly)} | ${escapeTable(hunk.qwenOnly)} |`);
    if (clip.hunks.length === 0) lines.push("| 完全一致 |  |  |");
    lines.push("");
  }
  lines.push("## 30 条时间戳边界抽样", "", "以下抽样保留原片绝对时间，必须结合原音人工回听记录实际误差；Whisper 的字符时间为估算，不能替代原音真值。", "", "| ID | 切片 | 字 | 原片时间 | Qwen 时间范围 | 精度 | 原音审核 |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const sample of report.boundarySamples) {
    lines.push(`| ${sample.id} | ${sample.clipId} | ${sample.character} | ${sample.sourceTimecode} | ${sample.sourceStartMs}-${sample.sourceEndMs}ms | ${sample.timestampPrecision} | 待回听 |`);
  }
  lines.push("", "边界质量门禁状态：**待原音人工审核**。要通过，30 条中至少 27 条的边界误差须不超过 150ms。", "");
  return `${lines.filter((line) => line !== "" || true).join("\n")}\n`;
}

function percent(value, total) {
  return total ? Math.round((value / total) * 10000) / 100 : 0;
}

function formatTimecode(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

function escapeTable(value) {
  return String(value || "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function toRepoPath(path) {
  return relative(repoRoot, path).split("\\").join("/");
}
