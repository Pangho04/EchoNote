"""EchoNote faster-whisper benchmark."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from importlib import metadata
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from typing import Any, Callable
import unicodedata


SPEAKER_LINE = re.compile(
    r"^(?:참석자|화자|speaker)\s*\d+\s+\d{1,2}:\d{2}(?::\d{2})?$",
    re.IGNORECASE,
)
CLOVA_FOOTER = re.compile(r"^(?:https?://)?(?:www\.)?clovanote\.naver\.com/?$", re.IGNORECASE)
DEFAULT_MODEL_NAME = "turbo"


def strip_clova_metadata(text: str) -> str:
    """Return transcript text without Clova headers, speaker markers, or footer."""
    lines = [line.strip() for line in text.splitlines()]
    first_speaker_index = next(
        (index for index, line in enumerate(lines) if SPEAKER_LINE.fullmatch(line)),
        None,
    )
    content_lines = lines[first_speaker_index + 1 :] if first_speaker_index is not None else lines

    return "\n".join(
        line
        for line in content_lines
        if line and not SPEAKER_LINE.fullmatch(line) and not CLOVA_FOOTER.fullmatch(line)
    )


def normalize_for_cer(text: str) -> str:
    """Normalize text into Unicode alphanumeric characters for CER."""
    normalized = unicodedata.normalize("NFKC", text).casefold()

    return "".join(character for character in normalized if character.isalnum())


def normalize_for_wer(text: str) -> list[str]:
    """Normalize text into whitespace-delimited alphanumeric tokens for WER."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    tokenizable = "".join(character if character.isalnum() else " " for character in normalized)

    return tokenizable.split()


def calculate_error_stats(reference: Sequence[str], hypothesis: Sequence[str]) -> dict[str, int | float]:
    """Calculate Levenshtein substitutions, deletions, insertions, and error rate."""
    reference_length = len(reference)
    hypothesis_length = len(hypothesis)
    distances = [[0] * (hypothesis_length + 1) for _ in range(reference_length + 1)]

    for reference_index in range(reference_length + 1):
        distances[reference_index][0] = reference_index

    for hypothesis_index in range(hypothesis_length + 1):
        distances[0][hypothesis_index] = hypothesis_index

    for reference_index in range(1, reference_length + 1):
        for hypothesis_index in range(1, hypothesis_length + 1):
            substitution_cost = reference[reference_index - 1] != hypothesis[hypothesis_index - 1]
            distances[reference_index][hypothesis_index] = min(
                distances[reference_index - 1][hypothesis_index] + 1,
                distances[reference_index][hypothesis_index - 1] + 1,
                distances[reference_index - 1][hypothesis_index - 1] + int(substitution_cost),
            )

    substitutions = 0
    deletions = 0
    insertions = 0
    reference_index = reference_length
    hypothesis_index = hypothesis_length

    while reference_index or hypothesis_index:
        if (
            reference_index
            and hypothesis_index
            and reference[reference_index - 1] == hypothesis[hypothesis_index - 1]
            and distances[reference_index][hypothesis_index]
            == distances[reference_index - 1][hypothesis_index - 1]
        ):
            reference_index -= 1
            hypothesis_index -= 1

            continue

        if (
            reference_index
            and hypothesis_index
            and distances[reference_index][hypothesis_index]
            == distances[reference_index - 1][hypothesis_index - 1] + 1
        ):
            substitutions += 1
            reference_index -= 1
            hypothesis_index -= 1

            continue

        if (
            reference_index
            and distances[reference_index][hypothesis_index]
            == distances[reference_index - 1][hypothesis_index] + 1
        ):
            deletions += 1
            reference_index -= 1

            continue

        insertions += 1
        hypothesis_index -= 1

    distance = substitutions + deletions + insertions
    rate = distance / reference_length if reference_length else float(bool(hypothesis_length))

    return {
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "distance": distance,
        "reference_length": reference_length,
        "hypothesis_length": hypothesis_length,
        "rate": rate,
        "percent": rate * 100,
    }


def calculate_transcript_metrics(reference: str, hypothesis: str) -> dict[str, dict[str, int | float]]:
    """Calculate normalized CER and WER metrics for two transcripts."""
    normalized_reference_characters = list(normalize_for_cer(reference))
    normalized_hypothesis_characters = list(normalize_for_cer(hypothesis))
    normalized_reference_words = normalize_for_wer(reference)
    normalized_hypothesis_words = normalize_for_wer(hypothesis)

    return {
        "cer": calculate_error_stats(
            normalized_reference_characters,
            normalized_hypothesis_characters,
        ),
        "wer": calculate_error_stats(
            normalized_reference_words,
            normalized_hypothesis_words,
        ),
    }


def read_gpu_memory_mib() -> int | None:
    """Return total used VRAM reported by nvidia-smi, or None when unavailable."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    values = [
        int(float(line.strip()))
        for line in result.stdout.splitlines()
        if line.strip()
    ]

    return max(values) if values else None


class GpuMemorySampler:
    """Sample total GPU memory while model loading and transcription run."""

    def __init__(
        self,
        *,
        interval_seconds: float = 0.25,
        reader: Callable[[], int | None] = read_gpu_memory_mib,
    ) -> None:
        self.interval_seconds = interval_seconds
        self.reader = reader
        self.baseline: int | None = None
        self.peak: int | None = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _sample(self) -> None:
        value = self.reader()

        if value is None:
            return

        with self._lock:
            self.peak = value if self.peak is None else max(self.peak, value)

    def _run(self) -> None:
        while not self._stop_event.wait(self.interval_seconds):
            self._sample()

    def start(self) -> None:
        self.baseline = self.reader()
        self.peak = self.baseline
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._sample()
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=max(1.0, self.interval_seconds * 2))

    def stats(self) -> dict[str, int | None]:
        with self._lock:
            peak_delta = (
                max(0, self.peak - self.baseline)
                if self.peak is not None and self.baseline is not None
                else None
            )

            return {
                "baseline": self.baseline,
                "peak": self.peak,
                "peak_delta": peak_delta,
            }


def segment_to_dict(segment: Any) -> dict[str, Any]:
    """Convert a faster-whisper segment into JSON-compatible data."""
    words = getattr(segment, "words", None) or []

    return {
        "id": getattr(segment, "id", None),
        "start": getattr(segment, "start", None),
        "end": getattr(segment, "end", None),
        "text": getattr(segment, "text", "").strip(),
        "avg_logprob": getattr(segment, "avg_logprob", None),
        "no_speech_prob": getattr(segment, "no_speech_prob", None),
        "words": [
            {
                "start": getattr(word, "start", None),
                "end": getattr(word, "end", None),
                "word": getattr(word, "word", "").strip(),
                "probability": getattr(word, "probability", None),
            }
            for word in words
        ],
    }


def default_model_factory(model_name: str, *, device: str, compute_type: str) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(model_name, device=device, compute_type=compute_type)


def package_version(package_name: str) -> str | None:
    try:
        return metadata.version(package_name)
    except metadata.PackageNotFoundError:
        return None


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def run_benchmark(
    *,
    audio_path: Path,
    reference_path: Path,
    output_directory: Path,
    model_name: str = DEFAULT_MODEL_NAME,
    model_factory: Callable[..., Any] = default_model_factory,
    timer: Callable[[], float] = time.perf_counter,
    gpu_memory_sampler: Any | None = None,
) -> dict[str, Any]:
    """Transcribe one audio file and write transcript, segments, and metrics."""
    if not audio_path.is_file():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if not reference_path.is_file():
        raise FileNotFoundError(f"Reference file not found: {reference_path}")

    output_directory.mkdir(parents=True, exist_ok=True)
    sampler = gpu_memory_sampler or GpuMemorySampler()
    overall_started_at = timer()
    sampler.start()

    try:
        model_load_started_at = timer()
        model_source = os.environ.get("ECHONOTE_WHISPER_MODEL_PATH", model_name)
        model = model_factory(model_source, device="cuda", compute_type="float16")
        model_load_seconds = timer() - model_load_started_at
        transcription_started_at = timer()
        segment_generator, info = model.transcribe(
            str(audio_path),
            language="ko",
            beam_size=5,
            vad_filter=True,
            word_timestamps=True,
            initial_prompt=None,
        )
        segments = list(segment_generator)
        transcription_seconds = timer() - transcription_started_at
    finally:
        sampler.stop()

    total_seconds = timer() - overall_started_at
    segment_payload = [segment_to_dict(segment) for segment in segments]
    transcript_lines = [segment["text"] for segment in segment_payload if segment["text"]]
    transcript = "\n".join(transcript_lines)
    reference = strip_clova_metadata(reference_path.read_text(encoding="utf-8-sig"))
    error_metrics = calculate_transcript_metrics(reference, transcript)
    duration_seconds = float(getattr(info, "duration", 0.0) or 0.0)
    duration_after_vad_seconds = float(getattr(info, "duration_after_vad", 0.0) or 0.0)
    realtime_factor = transcription_seconds / duration_seconds if duration_seconds else None
    speedup = duration_seconds / transcription_seconds if transcription_seconds else None
    metrics = {
        "configuration": {
            "model": model_name,
            "device": "cuda",
            "compute_type": "float16",
            "language": "ko",
            "beam_size": 5,
            "vad_filter": True,
            "word_timestamps": True,
            "initial_prompt": None,
        },
        "input": {
            "audio_file": audio_path.name,
            "reference_file": reference_path.name,
        },
        "transcription": {
            "detected_language": getattr(info, "language", None),
            "language_probability": getattr(info, "language_probability", None),
            "duration_seconds": duration_seconds,
            "duration_after_vad_seconds": duration_after_vad_seconds,
            "segment_count": len(segment_payload),
        },
        "timing_seconds": {
            "model_load": model_load_seconds,
            "transcription": transcription_seconds,
            "total": total_seconds,
            "realtime_factor": realtime_factor,
            "speedup": speedup,
        },
        "gpu_memory_mib": sampler.stats(),
        "versions": {
            "faster_whisper": package_version("faster-whisper"),
            "ctranslate2": package_version("ctranslate2"),
        },
        **error_metrics,
    }

    (output_directory / "transcript.txt").write_text(
        transcript + ("\n" if transcript else ""),
        encoding="utf-8",
    )
    write_json(output_directory / "segments.json", segment_payload)
    write_json(output_directory / "metrics.json", metrics)

    return metrics


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark faster-whisper against a reference transcript.")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--model",
        choices=("turbo", "large-v3"),
        default=DEFAULT_MODEL_NAME,
    )

    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    metrics = run_benchmark(
        audio_path=arguments.audio,
        reference_path=arguments.reference,
        output_directory=arguments.output_dir,
        model_name=arguments.model,
    )

    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
