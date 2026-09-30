"""EchoNote Worker STT container entrypoint.

Reads /input/audio.m4a and writes /output/result.json. The Worker validates the result again,
so this file only shapes the output. Transcript text never goes to stdout or stderr.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from typing import Any, Iterable


AUDIO_PATH = Path("/input/audio.m4a")
RESULT_PATH = Path("/output/result.json")
MODEL_PATH = Path("/model")
SCHEMA_VERSION = 1
EXIT_NO_GPU = 10
EXIT_NO_MODEL = 11


def to_ms(seconds: float) -> int:
    return round(seconds * 1000)


def build_result(duration_seconds: float, segments: Iterable[Any]) -> dict[str, Any]:
    """Round to integer ms and clamp so that start <= end <= duration holds."""
    duration_ms = to_ms(duration_seconds)
    payload_segments = []

    for segment in segments:
        # JS trim() treats BOM as whitespace; drop it so blank text matches the parser.
        text = segment.text.replace("\ufeff", "").strip()

        if not text:
            continue

        start_ms = min(to_ms(segment.start), duration_ms)
        end_ms = min(max(start_ms, to_ms(segment.end)), duration_ms)
        payload_segments.append({"startMs": start_ms, "endMs": end_ms, "text": text})

    return {"schemaVersion": SCHEMA_VERSION, "durationMs": duration_ms, "segments": payload_segments}


def write_result(path: Path, payload: dict[str, Any]) -> None:
    # The Worker never sees a half-written file: it is renamed only after the full write.
    temporary_path = path.with_name(path.name + ".tmp")

    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, allow_nan=False)

    os.replace(temporary_path, path)


def self_check() -> int:
    import ctranslate2

    if ctranslate2.get_cuda_device_count() == 0:
        return EXIT_NO_GPU

    if not (MODEL_PATH / "model.bin").is_file():
        return EXIT_NO_MODEL

    return 0


def transcribe() -> int:
    from faster_whisper import WhisperModel

    model = WhisperModel(str(MODEL_PATH), device="cuda", compute_type="float16")
    segments, info = model.transcribe(str(AUDIO_PATH), language="ko", beam_size=5, vad_filter=True)
    write_result(RESULT_PATH, build_result(info.duration, segments))

    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-check"]:
        return self_check()

    if argv:
        return 2

    return transcribe()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
