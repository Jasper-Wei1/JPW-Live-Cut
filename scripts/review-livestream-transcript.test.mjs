import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReview,
  createReviewPacket,
} from "./review-livestream-transcript.mjs";

const plan = {
  schemaVersion: 1,
  workflow: "clip-extraction-review",
  id: "test-live",
  preview: { status: "approved" },
  timeline: { status: "locked" },
  candidates: [
    {
      id: "clip-001",
      reviewStatus: "approved",
      timeline: { status: "locked", durationMs: 1000 },
      outputs: { transcript: "工作区/数据/已确认/source.json" },
    },
  ],
};

const transcript = {
  schemaVersion: 1,
  text: "阿西",
  utterances: [
    { index: 0, text: "阿", startMs: 0, endMs: 100 },
    { index: 1, text: "西", startMs: 100, endMs: 200 },
  ],
  tokens: [
    { utteranceIndex: 0, text: "阿" },
    { utteranceIndex: 1, text: "西" },
  ],
  characters: [
    { utteranceIndex: 0, text: "阿", character: "阿" },
    { utteranceIndex: 1, text: "西", character: "西" },
  ],
};

test("review packet is model-agnostic and exposes stable Qwen indexes", () => {
  const packet = createReviewPacket(plan, { "clip-001": transcript });
  assert.equal(packet.policy, "agent-llm-constrained-character-replacement-v1");
  assert.equal(packet.clips[0].units[0].text, "阿西");
  assert.equal(packet.responseSchema.reviewer.model, "model identifier");
});

test("候选尚未批准时也能生成切点审校包", () => {
  const pendingPlan = structuredClone(plan);
  pendingPlan.preview = { status: "pending" };
  delete pendingPlan.timeline;
  pendingPlan.candidates[0].reviewStatus = "pending";
  delete pendingPlan.candidates[0].outputs;
  pendingPlan.candidates[0].transcriptReview = {
    status: "pending",
    sourceTranscript: "工作区/数据/草稿/full-qwen.json",
  };
  pendingPlan.candidates[0].durationMs = 1000;
  const packet = createReviewPacket(pendingPlan, { "clip-001": transcript });
  assert.equal(packet.clips[0].sourceTranscript, "工作区/数据/草稿/full-qwen.json");
  assert.equal(packet.clips[0].durationMs, 1000);
});

test("applies only equal-length, timestamp-preserving corrections", () => {
  const [reviewed] = Object.values(
    applyReview({
      plan,
      transcripts: { "clip-001": transcript },
      review: {
        schemaVersion: 1,
        workflow: "livestream-transcript-llm-review-output",
        id: "test-live",
        reviewer: { model: "any-model", reviewedAt: "2026-07-28T00:00:00.000Z" },
        decisions: [
          {
            clipId: "clip-001",
            startUtteranceIndex: 1,
            endUtteranceIndex: 1,
            from: "西",
            to: "希",
            label: "homophone",
            evidence: "The phrase is a clear proper wording error.",
          },
        ],
        ambiguities: [],
      },
    }),
  );
  assert.equal(reviewed.text, "阿希");
  assert.equal(reviewed.utterances[1].startMs, 100);
  assert.equal(reviewed.tokens[1].text, "希");
  assert.equal(reviewed.characters[1].character, "希");
  assert.equal(reviewed.review.appliedCorrectionCount, 1);
});

test("rejects insertions and retains unresolved risks as ambiguities", () => {
  assert.throws(
    () =>
      applyReview({
        plan,
        transcripts: { "clip-001": transcript },
        review: {
          schemaVersion: 1,
          workflow: "livestream-transcript-llm-review-output",
          id: "test-live",
          reviewer: { model: "any-model", reviewedAt: "2026-07-28T00:00:00.000Z" },
          decisions: [
            {
              clipId: "clip-001",
              startUtteranceIndex: 0,
              endUtteranceIndex: 0,
              from: "阿",
              to: "阿啊",
              label: "obvious-typo",
              evidence: "This should fail because it inserts text.",
            },
          ],
          ambiguities: [],
        },
      }),
    /equal-length/u,
  );

  const reviewed = applyReview({
    plan,
    transcripts: { "clip-001": transcript },
    review: {
      schemaVersion: 1,
      workflow: "livestream-transcript-llm-review-output",
      id: "test-live",
      reviewer: { model: "another-model", reviewedAt: "2026-07-28T00:00:00.000Z" },
      decisions: [],
      ambiguities: [
        {
          clipId: "clip-001",
          startUtteranceIndex: 0,
          endUtteranceIndex: 1,
          sourceText: "阿西",
          labels: ["homophone"],
          reason: "Context alone cannot decide the original audio.",
        },
      ],
    },
  });
  assert.equal(reviewed["clip-001"].text, "阿西");
  assert.equal(reviewed["clip-001"].review.ambiguities.length, 1);
});
