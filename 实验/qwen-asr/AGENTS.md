# Qwen ASR Experiment Boundary

This directory supplies the official local runtime for the default production
transcriber and retains an isolated evaluation harness for the official local
`Qwen/Qwen3-ASR-0.6B` and `Qwen/Qwen3-ForcedAligner-0.6B` models.

- Use `npm run setup` and `npm run transcribe` for the default production
  path. `npm run qwen:transcribe` remains an isolated A/B entry and
  `npm run qwen:test` validates the shared normalizer.
- Model downloads are allowed only during setup and are stored in `缓存/`.
  Audio must never be sent to a URL, API, server, or cloud service.
- Transcription runs with local model directories and offline environment
  flags. The default command writes a schemaVersion 1 transcript to
  `工作区/数据/草稿/`; A/B results belong only in `结果/`.
- Keep Whisper caches and old Whisper transcripts. Whisper is an explicit
  fallback through `npm run whisper:transcribe`.
- The forced aligner receives sequential audio chunks no longer than 240
  seconds. Persist chunk boundaries and timestamp provenance with every run.
- Windows uses the same official local runtime with CPU `float32`; its support
  status remains pending a native setup, smoke-transcription, and full-media
  verification. Do not label it supported before those records exist.
