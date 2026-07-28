#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { remapTranscriptToRange } from "./livestream-clip-review.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REVIEW_POLICY = "agent-llm-constrained-character-replacement-v1";
const ALLOWED_LABELS = new Set([
  "obvious-typo",
  "homophone",
  "proper-noun",
  "number",
]);

export function createReviewPacket(plan, transcripts) {
  const candidates = reviewCandidates(plan);
  return {
    schemaVersion: 1,
    workflow: "livestream-transcript-llm-review-input",
    id: plan.id,
    policy: REVIEW_POLICY,
    instructions: [
      "Review the Qwen transcript for clear errors only. Do not rewrite, add, remove, reorder, or smooth sentences.",
      "For a correction, return the exact contiguous utterance indexes, source text, equal-length replacement text, one allowed label, and concise evidence.",
      "When context is insufficient, leave the Qwen text unchanged and record an ambiguity instead of guessing.",
      "Return only the response schema in the review output; the applying command rejects any unsafe correction.",
    ],
    responseSchema: {
      schemaVersion: 1,
      workflow: "livestream-transcript-llm-review-output",
      id: plan.id,
      reviewer: { model: "model identifier", reviewedAt: "ISO-8601" },
      decisions: [
        {
          clipId: "clip-001",
          startUtteranceIndex: 0,
          endUtteranceIndex: 0,
          from: "Qwen source text",
          to: "same-length replacement",
          label: "obvious-typo",
          evidence: "why this is clear",
        },
      ],
      ambiguities: [
        {
          clipId: "clip-001",
          startUtteranceIndex: 0,
          endUtteranceIndex: 0,
          sourceText: "Qwen source text",
          labels: ["homophone"],
          reason: "why no correction is safe",
        },
      ],
    },
    clips: candidates.map((candidate) => ({
      id: candidate.id,
      sourceTranscript:
        candidate.outputs?.transcript ?? candidate.transcriptReview?.sourceTranscript,
      durationMs: candidate.timeline?.durationMs ?? candidate.durationMs,
      units: makeReviewUnits(transcripts[candidate.id].utterances),
    })),
  };
}

export function applyReview({ plan, transcripts, review }) {
  validateReviewEnvelope(plan, review);
  const decisionsByClip = new Map();
  for (const decision of review.decisions ?? []) {
    const list = decisionsByClip.get(decision.clipId) ?? [];
    list.push(decision);
    decisionsByClip.set(decision.clipId, list);
  }
  const ambiguitiesByClip = new Map();
  for (const ambiguity of review.ambiguities ?? []) {
    const list = ambiguitiesByClip.get(ambiguity.clipId) ?? [];
    list.push(ambiguity);
    ambiguitiesByClip.set(ambiguity.clipId, list);
  }

  const output = {};
  for (const candidate of reviewCandidates(plan)) {
    const source = transcripts[candidate.id];
    const reviewed = structuredClone(source);
    const decisions = decisionsByClip.get(candidate.id) ?? [];
    const occupiedIndexes = new Set();
    const applied = [];
    for (const decision of decisions) {
      const normalized = validateDecision(source, decision, occupiedIndexes);
      applyDecision(reviewed, normalized);
      applied.push(normalized);
    }
    reviewed.text = reviewed.utterances.map(({ text }) => text).join("");
    reviewed.review = {
      status: "completed",
      correctionPolicy: REVIEW_POLICY,
      sourceTranscript:
        candidate.outputs?.transcript ?? candidate.transcriptReview?.sourceTranscript,
      reviewer: review.reviewer,
      appliedCorrections: applied,
      appliedCorrectionCount: applied.length,
      ambiguities: validateAmbiguities(
        source,
        ambiguitiesByClip.get(candidate.id) ?? [],
      ),
      createdAt: new Date().toISOString(),
    };
    output[candidate.id] = reviewed;
  }
  return output;
}

function isLockedPlan(plan) {
  return plan.preview?.status === "approved" && plan.timeline?.status === "locked";
}

function reviewCandidates(plan) {
  if (plan.schemaVersion !== 1 || plan.workflow !== "clip-extraction-review") {
    throw new Error("Review requires a schemaVersion 1 clip plan.");
  }
  const locked = isLockedPlan(plan);
  const candidates = locked
    ? plan.candidates.filter((candidate) => candidate.reviewStatus === "approved")
    : plan.candidates.filter((candidate) => candidate.reviewStatus !== "rejected");
  if (candidates.length === 0) throw new Error("No clips to review.");
  for (const candidate of candidates) {
    if (locked && (candidate.timeline?.status !== "locked" || !candidate.outputs?.transcript)) {
      throw new Error(`${candidate.id} is missing its locked Qwen transcript.`);
    }
  }
  return candidates;
}

function makeReviewUnits(utterances) {
  const units = [];
  let current = null;
  for (const utterance of utterances ?? []) {
    if (!utterance.text) continue;
    const startsAfterPause = current && utterance.startMs - current.endMs > 650;
    const reachesLimit =
      current && Array.from(`${current.text}${utterance.text}`).length > 40;
    if (startsAfterPause || reachesLimit) {
      units.push(current);
      current = null;
    }
    if (!current) {
      current = {
        startUtteranceIndex: utterance.index,
        endUtteranceIndex: utterance.index,
        startMs: utterance.startMs,
        endMs: utterance.endMs,
        text: utterance.text,
      };
    } else {
      current.endUtteranceIndex = utterance.index;
      current.endMs = utterance.endMs;
      current.text += utterance.text;
    }
  }
  if (current) units.push(current);
  return units;
}

function validateReviewEnvelope(plan, review) {
  if (
    review?.schemaVersion !== 1 ||
    review.workflow !== "livestream-transcript-llm-review-output" ||
    review.id !== plan.id
  ) {
    throw new Error("Review output does not match the approved clip plan.");
  }
  if (
    !review.reviewer ||
    typeof review.reviewer.model !== "string" ||
    !review.reviewer.model.trim() ||
    typeof review.reviewer.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(review.reviewer.reviewedAt))
  ) {
    throw new Error("Review output must identify the reviewing model and time.");
  }
  if (!Array.isArray(review.decisions) || !Array.isArray(review.ambiguities)) {
    throw new Error("Review output must contain decisions and ambiguities arrays.");
  }
}

function validateDecision(source, decision, occupiedIndexes) {
  const label = String(decision?.label ?? "");
  if (!ALLOWED_LABELS.has(label)) {
    throw new Error(`Unsupported correction label: ${label}.`);
  }
  if (typeof decision?.evidence !== "string" || !decision.evidence.trim()) {
    throw new Error("Every correction needs concise evidence.");
  }
  const indexes = rangeIndexes(source, decision);
  for (const index of indexes) {
    if (occupiedIndexes.has(index)) {
      throw new Error(`Overlapping corrections are not allowed at utterance ${index}.`);
    }
  }
  const from = indexes.map((index) => source.utterances[index].text).join("");
  if (decision.from !== from) throw new Error("Correction source text does not match Qwen output.");
  const replacement = Array.from(String(decision.to ?? ""));
  if (replacement.length !== indexes.length || decision.to === decision.from) {
    throw new Error("Corrections must be a non-empty, equal-length replacement.");
  }
  for (const index of indexes) {
    if (Array.from(source.utterances[index].text).length !== 1) {
      throw new Error("Corrections require one forced-aligner character per utterance.");
    }
    occupiedIndexes.add(index);
  }
  return { ...decision, indexes, from, to: replacement.join("") };
}

function validateAmbiguities(source, ambiguities) {
  return ambiguities.map((ambiguity) => {
    const indexes = rangeIndexes(source, ambiguity);
    const sourceText = indexes.map((index) => source.utterances[index].text).join("");
    if (ambiguity.sourceText !== sourceText || !String(ambiguity.reason ?? "").trim()) {
      throw new Error("Ambiguity must retain exact Qwen text and a reason.");
    }
    if (
      !Array.isArray(ambiguity.labels) ||
      ambiguity.labels.length === 0 ||
      ambiguity.labels.some((label) => !ALLOWED_LABELS.has(label))
    ) {
      throw new Error("Ambiguity labels must use the constrained review taxonomy.");
    }
    return { ...ambiguity, indexes };
  });
}

function rangeIndexes(source, item) {
  const start = Number(item?.startUtteranceIndex);
  const end = Number(item?.endUtteranceIndex);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error("Review ranges must use ordered integer utterance indexes.");
  }
  const indexes = [];
  for (let index = start; index <= end; index += 1) {
    if (!source.utterances[index] || source.utterances[index].index !== index) {
      throw new Error(`Review range references missing utterance ${index}.`);
    }
    indexes.push(index);
  }
  return indexes;
}

function applyDecision(transcript, decision) {
  decision.indexes.forEach((utteranceIndex, offset) => {
    const from = transcript.utterances[utteranceIndex].text;
    const to = Array.from(decision.to)[offset];
    transcript.utterances[utteranceIndex].text = to;
    const tokens = transcript.tokens.filter(
      (item) => item.utteranceIndex === utteranceIndex,
    );
    if (tokens.length !== 1 || tokens[0].text !== from) {
      throw new Error(`Forced-aligner token mismatch at utterance ${utteranceIndex}.`);
    }
    tokens[0].text = to;
    const characters = transcript.characters.filter(
      (item) => item.utteranceIndex === utteranceIndex,
    );
    if (characters.length !== 1 || characters[0].text !== from) {
      throw new Error(`Forced-aligner character mismatch at utterance ${utteranceIndex}.`);
    }
    characters[0].text = to;
    characters[0].character = to;
  });
}

await main();

async function main() {
  if (resolve(process.argv[1] ?? "") !== fileURLToPath(import.meta.url)) return;
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!args.plan) throw new Error("Missing --plan.");
  const planPath = resolve(process.cwd(), args.plan);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const transcripts = await loadSourceTranscripts(plan, args.transcript);
  if (args.command === "prepare") {
    if (!args.output) throw new Error("Missing --output.");
    await writeJson(resolve(process.cwd(), args.output), createReviewPacket(plan, transcripts), args.force);
    return;
  }
  if (args.command === "apply") {
    if (!args.review) throw new Error("Missing --review.");
    const review = JSON.parse(await readFile(resolve(process.cwd(), args.review), "utf8"));
    const reviewed = applyReview({ plan, transcripts, review });
    const locked = isLockedPlan(plan);
    for (const candidate of reviewCandidates(plan)) {
      const outputPath = join(
        REPO_ROOT,
        locked
          ? `工作区/数据/已确认/${plan.id}-${candidate.id}-reviewed-transcript.json`
          : `工作区/数据/草稿/${plan.id}-${candidate.id}-reviewed-transcript.json`,
      );
      await writeJson(outputPath, reviewed[candidate.id], args.force);
      if (!locked) {
        candidate.transcriptReview = {
          status: "completed",
          reviewedAt: reviewed[candidate.id].review.createdAt,
          sourceTranscript: candidate.transcriptReview?.sourceTranscript ?? args.transcript,
          reviewedTranscript: toRepoPath(outputPath),
        };
      }
    }
    if (!locked) {
      await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    }
    return;
  }
  throw new Error("Use prepare or apply.");
}

async function loadSourceTranscripts(plan, sourceTranscriptArg) {
  const transcripts = {};
  if (!isLockedPlan(plan)) {
    if (!sourceTranscriptArg) {
      throw new Error("Pending cutpoint review requires --transcript <full-qwen-transcript.json>.");
    }
    const sourcePath = resolve(process.cwd(), sourceTranscriptArg);
    await access(sourcePath, constants.R_OK);
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    if (source.schemaVersion !== 1 || !Array.isArray(source.utterances)) {
      throw new Error("Full Qwen transcript does not contain schemaVersion 1 utterances.");
    }
    for (const candidate of reviewCandidates(plan)) {
      const sourceTranscript = toRepoPath(sourcePath);
      candidate.transcriptReview ??= { status: "pending" };
      candidate.transcriptReview.sourceTranscript = sourceTranscript;
      transcripts[candidate.id] = remapTranscriptToRange(
        source,
        candidate,
        sourceTranscript,
      );
    }
    return transcripts;
  }
  for (const candidate of reviewCandidates(plan)) {
    const sourcePath = resolve(REPO_ROOT, candidate.outputs.transcript);
    await access(sourcePath, constants.R_OK);
    const transcript = JSON.parse(await readFile(sourcePath, "utf8"));
    if (transcript.schemaVersion !== 1 || !Array.isArray(transcript.utterances)) {
      throw new Error(`${candidate.id} does not contain a schemaVersion 1 Qwen transcript.`);
    }
    transcripts[candidate.id] = transcript;
  }
  return transcripts;
}

async function writeJson(path, value, force) {
  try {
    await access(path, constants.F_OK);
    if (!force) throw new Error(`Output already exists: ${toRepoPath(path)}. Use --force to replace it.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(toRepoPath(path));
}

function parseArgs(argv) {
  const args = { command: null, plan: null, transcript: null, output: null, review: null, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (index === 0 && ["prepare", "apply"].includes(value)) args.command = value;
    else if (value === "--plan") args.plan = argv[++index];
    else if (value === "--transcript") args.transcript = argv[++index];
    else if (value === "--output") args.output = argv[++index];
    else if (value === "--review") args.review = argv[++index];
    else if (value === "--force") args.force = true;
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run clips:transcript-review -- prepare --plan <clip-review-plan.json> [--transcript <full-qwen-transcript.json>] --output <review-input.json>
  npm run clips:transcript-review -- apply --plan <clip-review-plan.json> [--transcript <full-qwen-transcript.json>] --review <review-output.json>`);
}

function toRepoPath(path) {
  return relative(REPO_ROOT, path).split("\\").join("/");
}
