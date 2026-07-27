#!/usr/bin/env python3
"""Run the official local Qwen3-ASR + ForcedAligner stack on a WAV file."""

from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import sys
import time
import traceback
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from qwen_normalization import build_transcript, calculate_chunk_coverage, serialize_timestamp

ASR_MODEL_ID = "Qwen/Qwen3-ASR-0.6B"
ALIGNER_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B"


def main() -> None:
    args = parse_args()
    assert_local_path(args.audio, "audio")
    assert_local_path(args.asr_model_dir, "ASR model")
    assert_local_path(args.aligner_model_dir, "ForcedAligner model")
    for path in (args.audio, args.asr_model_dir, args.aligner_model_dir):
        if not Path(path).exists():
            raise FileNotFoundError(path)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    started = time.perf_counter()

    sample_rate, audio_duration_ms, chunks = read_wav_chunks(Path(args.audio), args.chunk_seconds)
    if sample_rate != 16000:
        raise ValueError(f"Expected 16 kHz WAV, got {sample_rate} Hz.")
    if args.media_duration_ms == 0:
        args.media_duration_ms = audio_duration_ms
    if abs(audio_duration_ms - args.media_duration_ms) > 1000:
        raise ValueError(
            f"Extracted audio duration differs from source media by {abs(audio_duration_ms - args.media_duration_ms)} ms."
        )

    torch, Qwen3ASRModel = load_runtime()
    device, dtype = select_device(torch, args.device)
    model_started = time.perf_counter()
    model = Qwen3ASRModel.from_pretrained(
        args.asr_model_dir,
        dtype=dtype,
        device_map=device,
        max_inference_batch_size=1,
        max_new_tokens=args.max_new_tokens,
        forced_aligner=args.aligner_model_dir,
        forced_aligner_kwargs={"dtype": dtype, "device_map": device},
        local_files_only=True,
    )
    model_load_ms = round((time.perf_counter() - model_started) * 1000)

    raw_chunks: list[dict[str, Any]] = []
    for chunk in chunks:
        infer_started = time.perf_counter()
        result = model.transcribe(
            audio=(chunk["samples"], sample_rate),
            language="Chinese",
            return_time_stamps=True,
        )
        if not isinstance(result, list) or len(result) != 1:
            raise ValueError(f"Unexpected Qwen result for chunk {chunk['index']}: {type(result)!r}")
        item = result[0]
        timestamps = getattr(item, "time_stamps", None)
        if not timestamps:
            raise ValueError(f"Chunk {chunk['index']} returned no ForcedAligner timestamps.")
        raw_chunks.append(
            {
                "index": chunk["index"],
                "startMs": chunk["startMs"],
                "endMs": chunk["endMs"],
                "durationMs": chunk["endMs"] - chunk["startMs"],
                "text": str(getattr(item, "text", "")),
                "language": str(getattr(item, "language", "")),
                "timeStamps": [serialize_timestamp(timestamp) for timestamp in timestamps],
                "inferenceMs": round((time.perf_counter() - infer_started) * 1000),
            }
        )
        print(
            f"completed chunk {chunk['index'] + 1}/{len(chunks)} "
            f"({chunk['startMs']}ms-{chunk['endMs']}ms)",
            flush=True,
        )

    normalized = build_transcript(
        chunks=raw_chunks,
        source=args.source,
        media_duration_ms=args.media_duration_ms,
        audio_duration_ms=audio_duration_ms,
        model=ASR_MODEL_ID,
        aligner_model=ALIGNER_MODEL_ID,
        created_at=created_at,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    metrics = build_metrics(
        torch=torch,
        device=device,
        dtype=str(dtype).replace("torch.", ""),
        chunks=raw_chunks,
        audio_duration_ms=audio_duration_ms,
        media_duration_ms=args.media_duration_ms,
        model_load_ms=model_load_ms,
        elapsed_ms=elapsed_ms,
    )
    raw = {
        "schemaVersion": 1,
        "provider": "official-qwen-asr-python-package",
        "asrModel": ASR_MODEL_ID,
        "alignerModel": ALIGNER_MODEL_ID,
        "audioLocalOnly": True,
        "networkDisabledDuringTranscription": True,
        "source": args.source,
        "sourceSizeBytes": args.source_size_bytes,
        "audio": {
            "sampleRate": sample_rate,
            "durationMs": audio_duration_ms,
            "chunkSeconds": args.chunk_seconds,
            "chunkCoverage": calculate_chunk_coverage(raw_chunks, audio_duration_ms),
        },
        "chunks": raw_chunks,
    }
    write_json(output_dir / args.raw_output_name, raw)
    write_json(output_dir / args.normalized_output_name, normalized)
    write_json(output_dir / args.metrics_output_name, metrics)
    print(json.dumps({"status": "ok", "elapsedMs": elapsed_ms, "output": str(output_dir)}, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-size-bytes", type=int, required=True)
    parser.add_argument("--media-duration-ms", type=int, required=True)
    parser.add_argument("--chunk-seconds", type=int, default=240)
    parser.add_argument("--asr-model-dir", required=True)
    parser.add_argument("--aligner-model-dir", required=True)
    parser.add_argument("--device", choices=("auto", "mps", "cpu"), default="auto")
    parser.add_argument("--max-new-tokens", type=int, default=2048)
    parser.add_argument("--raw-output-name", default="qwen-raw.json")
    parser.add_argument("--normalized-output-name", default="transcript.qwen.json")
    parser.add_argument("--metrics-output-name", default="run-metrics.json")
    args = parser.parse_args()
    if args.chunk_seconds < 1 or args.chunk_seconds > 240:
        parser.error("--chunk-seconds must be within 1-240")
    if args.media_duration_ms < 0 or args.max_new_tokens <= 0:
        parser.error("duration must be nonnegative and max tokens must be positive")
    for name in (args.raw_output_name, args.normalized_output_name, args.metrics_output_name):
        if not name or Path(name).name != name:
            parser.error("output file names must be plain file names")
    return args


def load_runtime():
    # Imports happen after the local-path and duration guards, so no audio is
    # ever handed to a provider before offline mode has been established.
    import torch
    from qwen_asr import Qwen3ASRModel

    return torch, Qwen3ASRModel


def select_device(torch, requested: str):
    mps_available = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if requested == "mps" and not mps_available:
        raise RuntimeError("MPS was requested but is unavailable.")
    device = "mps" if requested == "auto" and mps_available else requested
    if device == "auto":
        device = "cpu"
    # float16 keeps both 0.6B models inside the M5/16GB evaluation envelope.
    return device, torch.float16 if device == "mps" else torch.float32


def read_wav_chunks(path: Path, chunk_seconds: int):
    with wave.open(str(path), "rb") as reader:
        channels = reader.getnchannels()
        sample_width = reader.getsampwidth()
        sample_rate = reader.getframerate()
        frames = reader.getnframes()
        if channels != 1 or sample_width != 2:
            raise ValueError("Expected 16-bit mono PCM WAV extracted by the local wrapper.")
        chunk_frames = sample_rate * chunk_seconds
        chunks = []
        index = 0
        frame_start = 0
        while frame_start < frames:
            frame_count = min(chunk_frames, frames - frame_start)
            pcm = reader.readframes(frame_count)
            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
            start_ms = round(frame_start * 1000 / sample_rate)
            end_ms = round((frame_start + frame_count) * 1000 / sample_rate)
            chunks.append(
                {
                    "index": index,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "samples": samples,
                }
            )
            index += 1
            frame_start += frame_count
    return sample_rate, round(frames * 1000 / sample_rate), chunks


def build_metrics(*, torch, device: str, dtype: str, chunks, audio_duration_ms, media_duration_ms, model_load_ms, elapsed_ms):
    mps_current = None
    mps_driver = None
    if device == "mps":
        try:
            mps_current = int(torch.mps.current_allocated_memory())
            mps_driver = int(torch.mps.driver_allocated_memory())
        except (AttributeError, RuntimeError):
            pass
    return {
        "status": "completed",
        "audioLocalOnly": True,
        "networkDisabledDuringTranscription": True,
        "officialRuntime": "qwen-asr==0.0.6",
        "configuration": {
            "asrModel": ASR_MODEL_ID,
            "alignerModel": ALIGNER_MODEL_ID,
            "device": device,
            "dtype": dtype,
            "maxInferenceBatchSize": 1,
            "maxNewTokens": 2048,
            "chunkSeconds": (chunks[0]["durationMs"] / 1000) if chunks else None,
        },
        "system": {
            "platform": platform.platform(),
            "python": sys.version.split()[0],
            "peakProcessRssBytes": peak_rss_bytes(),
            "mpsCurrentAllocatedBytes": mps_current,
            "mpsDriverAllocatedBytes": mps_driver,
        },
        "performance": {
            "modelLoadMs": model_load_ms,
            "transcriptionAndAlignmentMs": elapsed_ms,
            "audioDurationMs": audio_duration_ms,
            "mediaDurationMs": media_duration_ms,
            "realTimeFactor": round(elapsed_ms / audio_duration_ms, 4),
            "withinMediaDuration": elapsed_ms <= media_duration_ms,
        },
        "chunks": [
            {
                "index": item["index"],
                "startMs": item["startMs"],
                "endMs": item["endMs"],
                "inferenceMs": item["inferenceMs"],
            }
            for item in chunks
        ],
    }


def peak_rss_bytes() -> int:
    # macOS reports ru_maxrss in bytes; Linux reports KiB.
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def assert_local_path(value: str, label: str) -> None:
    if value.lower().startswith(("http://", "https://", "data:")):
        raise ValueError(f"{label} must be a local path, never a URL.")


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def argument_value(flag: str) -> Optional[str]:
    try:
        return sys.argv[sys.argv.index(flag) + 1]
    except (ValueError, IndexError):
        return None


if __name__ == "__main__":
    # Do not relax these flags: model weights are already local and the input
    # audio must never trigger an outbound request during the experiment.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("MODELSCOPE_OFFLINE", "1")
    try:
        main()
    except Exception as error:
        output_dir = argument_value("--output-dir")
        if output_dir:
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            write_json(
                Path(output_dir) / "python-failure.json",
                {
                    "status": "failed",
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                    "audioLocalOnly": True,
                    "networkDisabledDuringTranscription": True,
                },
            )
        raise
