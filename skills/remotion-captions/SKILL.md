---
name: remotion-captions
description: Dealing with captions in Remotion
metadata:
  tags: subtitles, captions, remotion, json
---

All captions must be processed in JSON. The captions must use the [`Caption`](https://www.remotion.dev/docs/captions/caption.md) type which is the following:

```ts
import type { Caption } from "@remotion/captions";
```

This is the definition:

```ts
type Caption = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};
```

## Generating captions

Use `npm run transcribe -- --input <media> --name <name>` from the repository root. This project only permits local `Qwen3-ASR-0.6B + Qwen3-ForcedAligner-0.6B`; do not add another ASR model or cloud transcription service.

## Displaying captions

To display captions in your video, load the [display-captions.md](display-captions.md) file for more instructions.

## Importing captions

To import captions from a .srt file, load the [import-srt-captions.md](import-srt-captions.md) file for more instructions.
