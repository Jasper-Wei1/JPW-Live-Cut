"""SchemaVersion 1 normalization for local Qwen3-ASR experiment results."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, is_dataclass
from typing import Any, Optional


def serialize_timestamp(value: Any) -> dict[str, Any]:
    """Keep the model-reported timestamp values before converting to milliseconds."""
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        mapping = value
    else:
        mapping = {
            key: getattr(value, key)
            for key in ("text", "start_time", "end_time", "start", "end", "confidence")
            if hasattr(value, key)
        }
    text = str(mapping.get("text", "")).strip()
    start_seconds = _number(
        mapping.get("start_time", mapping.get("startSeconds", mapping.get("start")))
    )
    end_seconds = _number(
        mapping.get("end_time", mapping.get("endSeconds", mapping.get("end")))
    )
    confidence = _number(mapping.get("confidence"))
    if not text or start_seconds is None or end_seconds is None or end_seconds < start_seconds:
        raise ValueError(f"ForcedAligner returned an invalid timestamp unit: {value!r}")
    return {
        "text": text,
        "startSeconds": start_seconds,
        "endSeconds": end_seconds,
        "confidence": confidence,
        "pointTimestamp": end_seconds == start_seconds,
    }


def build_transcript(
    *,
    chunks: Iterable[dict[str, Any]],
    source: str,
    media_duration_ms: int,
    audio_duration_ms: int,
    model: str,
    aligner_model: str,
    created_at: str,
) -> dict[str, Any]:
    """Convert Qwen's native aligner units into the existing transcript contract.

    A multi-character aligner unit is intentionally not relabeled as exact
    character timing. Its characters are retained for consumers but marked as
    proportional derivations. This makes the quality gate auditable.
    """
    utterances: list[dict[str, Any]] = []
    tokens: list[dict[str, Any]] = []
    characters: list[dict[str, Any]] = []
    captions: list[dict[str, Any]] = []
    raw_units: list[dict[str, Any]] = []

    for chunk in chunks:
        chunk_start_ms = int(chunk["startMs"])
        for raw_unit in chunk["timeStamps"]:
            unit = serialize_timestamp(raw_unit)
            start_ms = chunk_start_ms + round(unit["startSeconds"] * 1000)
            end_ms = chunk_start_ms + round(unit["endSeconds"] * 1000)
            start_ms = max(chunk_start_ms, start_ms)
            end_ms = min(int(chunk["endMs"]), end_ms)
            point_timestamp = bool(unit["pointTimestamp"])
            if end_ms <= start_ms:
                # Qwen occasionally reports a valid point boundary for a very
                # short character. Preserve the native point in raw metadata;
                # schemaVersion 1 needs a positive span, so represent it as the
                # smallest possible 1ms non-exact span.
                end_ms = min(int(chunk["endMs"]), start_ms + 1)
                if end_ms <= start_ms:
                    start_ms = max(chunk_start_ms, end_ms - 1)
                point_timestamp = True
            if end_ms <= start_ms:
                raise ValueError("ForcedAligner timestamp cannot be represented inside its chunk.")

            utterance_index = len(utterances)
            unit_text = unit["text"]
            utterances.append(
                {
                    "index": utterance_index,
                    "text": unit_text,
                    "startMs": start_ms,
                    "endMs": end_ms,
                }
            )
            captions.append(
                {
                    "text": unit_text,
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "timestampMs": start_ms,
                    "confidence": unit["confidence"],
                    "timestampSource": "qwen3-forced-aligner",
                    "timestampPrecision": "point-expanded-1ms" if point_timestamp else "model-reported-seconds",
                    "pointTimestamp": point_timestamp,
                }
            )
            raw_units.append(
                {
                    "chunkIndex": chunk["index"],
                    "chunkStartMs": chunk_start_ms,
                    "text": unit_text,
                    "startSeconds": unit["startSeconds"],
                    "endSeconds": unit["endSeconds"],
                    "absoluteStartMs": start_ms,
                    "absoluteEndMs": end_ms,
                    "pointTimestamp": point_timestamp,
                }
            )

            # A token is exactly one native ForcedAligner unit. Do not split a
            # multi-character unit and accidentally present derived character
            # boundaries as model-reported boundaries.
            token = {
                "text": unit_text,
                "startMs": start_ms,
                "endMs": end_ms,
                "utteranceIndex": utterance_index,
                "tokenIndex": 0,
                "confidence": unit["confidence"],
                "estimated": False,
                "timestampSource": "qwen3-forced-aligner",
                "timestampPrecision": "aligned-unit",
                "pointTimestamp": point_timestamp,
            }
            tokens.append(token)
            append_characters(characters, token)

    if not utterances:
        raise ValueError("Qwen result did not contain usable forced-alignment timestamps.")
    _validate_monotonic(utterances)

    han_characters = [item for item in characters if is_han(item["character"])]
    exact_han_characters = [item for item in han_characters if item["exact"]]
    audio_duration_error_ms = abs(audio_duration_ms - media_duration_ms)
    chunk_coverage = calculate_chunk_coverage(list(chunks), audio_duration_ms)
    return {
        "schemaVersion": 1,
        "provider": "local-qwen3-asr",
        "model": model,
        "alignerModel": aligner_model,
        "source": source,
        "createdAt": created_at,
        "durationMs": media_duration_ms,
        "timingGranularity": "forced-aligner-unit",
        "chineseCharacterTiming": (
            "unavailable"
            if not han_characters
            else "exact"
            if len(exact_han_characters) == len(han_characters)
            else "partial"
        ),
        "timingCoverage": {
            "hanCharacters": {
                "total": len(han_characters),
                "exact": len(exact_han_characters),
                "exactPercent": rounded_percent(len(exact_han_characters), len(han_characters)),
            },
            "audioChunks": chunk_coverage,
        },
        "sourceMedia": {
            "durationMs": media_duration_ms,
            "audioDurationMs": audio_duration_ms,
            "durationErrorMs": audio_duration_error_ms,
        },
        "text": "".join(item["text"] for item in utterances),
        "utterances": utterances,
        "tokens": tokens,
        "characters": characters,
        "captions": captions,
        "qwenTimestampUnits": raw_units,
        "warnings": [
            "时间戳来自 Qwen3-ForcedAligner；多字对齐单元的字符时间被保留但明确标记为非精确推导。",
        ],
    }


def calculate_chunk_coverage(chunks: list[dict[str, Any]], duration_ms: int) -> dict[str, Any]:
    if duration_ms <= 0:
        raise ValueError("Audio duration must be positive.")
    ordered = sorted(chunks, key=lambda item: item["startMs"])
    cursor = 0
    gaps = []
    overlaps = []
    for chunk in ordered:
        start_ms = int(chunk["startMs"])
        end_ms = int(chunk["endMs"])
        if start_ms > cursor:
            gaps.append({"startMs": cursor, "endMs": start_ms})
        if start_ms < cursor:
            overlaps.append({"startMs": start_ms, "endMs": min(cursor, end_ms)})
        cursor = max(cursor, end_ms)
    if cursor < duration_ms:
        gaps.append({"startMs": cursor, "endMs": duration_ms})
    covered_ms = duration_ms - sum(item["endMs"] - item["startMs"] for item in gaps)
    return {
        "sourceDurationMs": duration_ms,
        "coveredMs": covered_ms,
        "coveragePercent": rounded_percent(covered_ms, duration_ms),
        "gaps": gaps,
        "overlaps": overlaps,
        "chunkCount": len(ordered),
    }


def append_characters(characters: list[dict[str, Any]], token: dict[str, Any]) -> None:
    graphemes = [item for item in token["text"] if not item.isspace()]
    if not graphemes:
        return
    exact = len(graphemes) == 1 and not token.get("pointTimestamp", False)
    duration = token["endMs"] - token["startMs"]
    for index, character in enumerate(graphemes):
        characters.append(
            {
                **token,
                "text": character,
                "character": character,
                "startMs": token["startMs"]
                if exact
                else token["startMs"] + round(duration * index / len(graphemes)),
                "endMs": token["endMs"]
                if exact
                else token["startMs"] + round(duration * (index + 1) / len(graphemes)),
                "exact": exact,
                "timingMethod": "forced-aligner-unit" if exact else "proportional-from-aligned-unit",
            }
        )


def is_han(character: str) -> bool:
    return "\u4e00" <= character <= "\u9fff"


def rounded_percent(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 2) if denominator else 0.0


def _number(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _validate_monotonic(utterances: list[dict[str, Any]]) -> None:
    prior_start = -1
    for utterance in utterances:
        if utterance["startMs"] < prior_start:
            raise ValueError("ForcedAligner timestamps are not monotonically ordered.")
        prior_start = utterance["startMs"]
