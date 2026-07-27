import unittest

from qwen_normalization import build_transcript, calculate_chunk_coverage


class QwenNormalizationTest(unittest.TestCase):
    def test_normalizes_exact_chinese_aligner_units_to_schema_v1(self):
        transcript = build_transcript(
            chunks=[
                {
                    "index": 0,
                    "startMs": 0,
                    "endMs": 1000,
                    "timeStamps": [
                        {"text": "你", "startSeconds": 0.0, "endSeconds": 0.25},
                        {"text": "好", "startSeconds": 0.25, "endSeconds": 0.5},
                    ],
                },
                {
                    "index": 1,
                    "startMs": 1000,
                    "endMs": 2000,
                    "timeStamps": [
                        {"text": "啊", "startSeconds": 0.0, "endSeconds": 0.4},
                    ],
                },
            ],
            source="实验/qwen-asr/input.wav",
            media_duration_ms=2000,
            audio_duration_ms=2000,
            model="Qwen/Qwen3-ASR-0.6B",
            aligner_model="Qwen/Qwen3-ForcedAligner-0.6B",
            created_at="2026-07-26T00:00:00.000Z",
        )
        self.assertEqual(transcript["schemaVersion"], 1)
        self.assertEqual(transcript["durationMs"], 2000)
        self.assertEqual(transcript["text"], "你好啊")
        self.assertEqual(transcript["characters"][2]["startMs"], 1000)
        self.assertEqual(transcript["timingCoverage"]["audioChunks"]["coveragePercent"], 100)
        self.assertEqual(transcript["timingCoverage"]["hanCharacters"]["exactPercent"], 100)

    def test_marks_multi_character_aligner_units_as_not_exact(self):
        transcript = build_transcript(
            chunks=[
                {
                    "index": 0,
                    "startMs": 0,
                    "endMs": 1000,
                    "timeStamps": [{"text": "你好", "startSeconds": 0, "endSeconds": 1}],
                }
            ],
            source="实验/qwen-asr/input.wav",
            media_duration_ms=1000,
            audio_duration_ms=1000,
            model="Qwen/Qwen3-ASR-0.6B",
            aligner_model="Qwen/Qwen3-ForcedAligner-0.6B",
            created_at="2026-07-26T00:00:00.000Z",
        )
        self.assertEqual(transcript["chineseCharacterTiming"], "partial")
        self.assertFalse(transcript["characters"][0]["exact"])

    def test_rejects_timeline_gaps(self):
        coverage = calculate_chunk_coverage(
            [{"startMs": 0, "endMs": 500}, {"startMs": 700, "endMs": 1000}], 1000
        )
        self.assertEqual(coverage["coveragePercent"], 80)
        self.assertEqual(coverage["gaps"], [{"startMs": 500, "endMs": 700}])

    def test_preserves_point_timestamp_without_dropping_the_character(self):
        transcript = build_transcript(
            chunks=[
                {
                    "index": 0,
                    "startMs": 0,
                    "endMs": 1000,
                    "timeStamps": [{"text": "的", "startSeconds": 0.5, "endSeconds": 0.5}],
                }
            ],
            source="实验/qwen-asr/input.wav",
            media_duration_ms=1000,
            audio_duration_ms=1000,
            model="Qwen/Qwen3-ASR-0.6B",
            aligner_model="Qwen/Qwen3-ForcedAligner-0.6B",
            created_at="2026-07-26T00:00:00.000Z",
        )
        self.assertEqual(transcript["text"], "的")
        self.assertEqual(transcript["characters"][0]["startMs"], 500)
        self.assertEqual(transcript["characters"][0]["endMs"], 501)
        self.assertFalse(transcript["characters"][0]["exact"])
        self.assertTrue(transcript["qwenTimestampUnits"][0]["pointTimestamp"])


if __name__ == "__main__":
    unittest.main()
