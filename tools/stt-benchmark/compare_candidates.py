"""Compare low-confidence turbo words with timestamp-aligned large-v3 output."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
import unicodedata


DEFAULT_THRESHOLD = 0.5
DEFAULT_PREVIEW_LIMIT = 20
DEFAULT_TOLERANCE_SECONDS = 0.4
MINIMUM_OVERLAP_RATIO = 0.5


def normalize_token(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()

    return "".join(character for character in normalized if character.isalnum())


def extract_candidates(
    turbo_segments: list[dict[str, Any]],
    *,
    threshold: float,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for segment in turbo_segments:
        for word in segment.get("words", []):
            probability = word.get("probability")

            if probability is None or probability >= threshold:
                continue

            candidates.append(
                {
                    "start": word.get("start"),
                    "end": word.get("end"),
                    "turbo_word": word.get("word", ""),
                    "probability": probability,
                    "turbo_segment_id": segment.get("id"),
                    "turbo_segment_text": segment.get("text", ""),
                },
            )

    candidates.sort(key=lambda candidate: (candidate["probability"], candidate["start"] or 0.0))

    return [
        {"candidate_id": index, **candidate}
        for index, candidate in enumerate(candidates, start=1)
    ]


def align_candidates(
    candidates: list[dict[str, Any]],
    large_v3_segments: list[dict[str, Any]],
    *,
    tolerance_seconds: float,
) -> list[dict[str, Any]]:
    aligned: list[dict[str, Any]] = []

    for candidate in candidates:
        candidate_start = candidate.get("start")
        candidate_end = candidate.get("end")

        if candidate_start is None or candidate_end is None:
            aligned.append(
                {
                    **candidate,
                    "large_v3_words": "",
                    "large_v3_segment_id": None,
                    "large_v3_segment_ids": [],
                    "large_v3_segment_text": "",
                    "has_large_v3_match": False,
                    "has_direct_overlap": False,
                    "alignment_method": "unmatched",
                    "alignment_ambiguous": True,
                    "model_disagreement": None,
                },
            )

            continue

        start = float(candidate_start)
        end = float(candidate_end)
        candidate_middle = (start + end) / 2
        overlapping_entries: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
        selected_entries: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
        alignment_method = "unmatched"

        for segment in large_v3_segments:
            for word in segment.get("words", []):
                word_start = word.get("start")
                word_end = word.get("end")

                if word_start is None or word_end is None:
                    continue

                overlap = min(float(word_end), end) - max(float(word_start), start)
                minimum_duration = min(
                    end - start,
                    float(word_end) - float(word_start),
                )
                overlap_ratio = overlap / minimum_duration if minimum_duration > 0 else 0.0

                if overlap > 0 and overlap_ratio >= MINIMUM_OVERLAP_RATIO:
                    overlapping_entries.append((overlap, segment, word))

        if overlapping_entries:
            overlapping_entries.sort(
                key=lambda entry: (
                    float(entry[2]["start"]),
                    float(entry[2]["end"]),
                    -entry[0],
                ),
            )

            for entry in overlapping_entries:
                if not selected_entries:
                    selected_entries.append(entry)

                    continue

                previous = selected_entries[-1]
                previous_word = previous[2]
                word = entry[2]
                word_start = float(word["start"])
                previous_start = float(previous_word["start"])
                previous_end = float(previous_word["end"])

                if word_start >= previous_end - 0.02 and word_start > previous_start:
                    selected_entries.append(entry)
                elif entry[0] > previous[0]:
                    selected_entries[-1] = entry

            alignment_method = "overlap"
        else:
            nearby_words: list[tuple[float, dict[str, Any], dict[str, Any]]] = []

            for segment in large_v3_segments:
                for word in segment.get("words", []):
                    word_start = word.get("start")
                    word_end = word.get("end")

                    if word_start is None or word_end is None:
                        continue

                    word_middle = (float(word_start) + float(word_end)) / 2
                    distance = abs(word_middle - candidate_middle)

                    if distance <= tolerance_seconds:
                        nearby_words.append((distance, segment, word))

            if nearby_words:
                _, matched_segment, nearest_word = min(nearby_words, key=lambda item: item[0])
                selected_entries.append((0.0, matched_segment, nearest_word))
                alignment_method = "nearest"

        selected_words = [entry[2] for entry in selected_entries]
        matched_segments: list[dict[str, Any]] = []

        for _, segment, _ in selected_entries:
            if segment not in matched_segments:
                matched_segments.append(segment)

        large_v3_words = " ".join(
            str(word.get("word", "")).strip()
            for word in selected_words
            if str(word.get("word", "")).strip()
        )
        has_match = bool(large_v3_words)
        has_direct_overlap = has_match and alignment_method == "overlap"
        alignment_ambiguous = end <= start or alignment_method != "overlap"
        model_disagreement = (
            normalize_token(str(candidate.get("turbo_word", "")))
            != normalize_token(large_v3_words)
            if has_match and not alignment_ambiguous
            else None
        )
        segment_ids = [segment.get("id") for segment in matched_segments]
        segment_texts = [
            str(segment.get("text", ""))
            for segment in matched_segments
            if str(segment.get("text", ""))
        ]
        aligned.append(
            {
                **candidate,
                "large_v3_words": large_v3_words,
                "large_v3_segment_id": segment_ids[0] if segment_ids else None,
                "large_v3_segment_ids": segment_ids,
                "large_v3_segment_text": " / ".join(dict.fromkeys(segment_texts)),
                "has_large_v3_match": has_match,
                "has_direct_overlap": has_direct_overlap,
                "alignment_method": alignment_method,
                "alignment_ambiguous": alignment_ambiguous,
                "model_disagreement": model_disagreement,
            },
        )

    return aligned


def metric_percent(metrics: dict[str, Any], metric_name: str) -> float:
    return float(metrics[metric_name]["percent"])


def build_report(
    *,
    turbo_segments: list[dict[str, Any]],
    large_v3_segments: list[dict[str, Any]],
    turbo_metrics: dict[str, Any],
    large_v3_metrics: dict[str, Any],
    threshold: float = DEFAULT_THRESHOLD,
    preview_limit: int = DEFAULT_PREVIEW_LIMIT,
    tolerance_seconds: float = DEFAULT_TOLERANCE_SECONDS,
    expected_candidate_count: int | None = None,
) -> dict[str, Any]:
    candidates = extract_candidates(turbo_segments, threshold=threshold)

    if expected_candidate_count is not None and len(candidates) != expected_candidate_count:
        raise ValueError(
            f"Expected {expected_candidate_count} candidates, found {len(candidates)}",
        )

    aligned_candidates = align_candidates(
        candidates,
        large_v3_segments,
        tolerance_seconds=tolerance_seconds,
    )
    covered_count = sum(candidate["has_large_v3_match"] for candidate in aligned_candidates)
    direct_overlap_count = sum(
        candidate["alignment_method"] == "overlap"
        for candidate in aligned_candidates
    )
    nearest_match_count = sum(
        candidate["alignment_method"] == "nearest"
        for candidate in aligned_candidates
    )
    disagreement_count = sum(
        candidate["model_disagreement"] is True
        for candidate in aligned_candidates
    )
    agreement_count = sum(
        candidate["model_disagreement"] is False
        for candidate in aligned_candidates
    )
    ambiguous_count = sum(candidate["alignment_ambiguous"] for candidate in aligned_candidates)
    priority_candidates = aligned_candidates[:preview_limit]
    turbo_cer = metric_percent(turbo_metrics, "cer")
    large_v3_cer = metric_percent(large_v3_metrics, "cer")
    turbo_wer = metric_percent(turbo_metrics, "wer")
    large_v3_wer = metric_percent(large_v3_metrics, "wer")

    return {
        "configuration": {
            "candidate_probability_threshold_exclusive": threshold,
            "timestamp_tolerance_seconds": tolerance_seconds,
            "minimum_overlap_ratio": MINIMUM_OVERLAP_RATIO,
            "priority_preview_limit": preview_limit,
            "expected_candidate_count": expected_candidate_count,
        },
        "summary": {
            "candidate_count": len(aligned_candidates),
            "covered_candidate_count": covered_count,
            "uncovered_candidate_count": len(aligned_candidates) - covered_count,
            "direct_overlap_count": direct_overlap_count,
            "nearest_match_count": nearest_match_count,
            "model_agreement_count": agreement_count,
            "model_disagreement_count": disagreement_count,
            "ambiguous_alignment_count": ambiguous_count,
            "priority_preview_count": len(priority_candidates),
        },
        "metrics_comparison": {
            "turbo_cer_percent": turbo_cer,
            "large_v3_cer_percent": large_v3_cer,
            "cer_delta_percentage_points": large_v3_cer - turbo_cer,
            "turbo_wer_percent": turbo_wer,
            "large_v3_wer_percent": large_v3_wer,
            "wer_delta_percentage_points": large_v3_wer - turbo_wer,
            "turbo_transcription_seconds": turbo_metrics["timing_seconds"]["transcription"],
            "large_v3_transcription_seconds": large_v3_metrics["timing_seconds"]["transcription"],
            "turbo_peak_gpu_memory_mib": turbo_metrics["gpu_memory_mib"]["peak"],
            "large_v3_peak_gpu_memory_mib": large_v3_metrics["gpu_memory_mib"]["peak"],
        },
        "priority_candidates": priority_candidates,
        "all_candidates": aligned_candidates,
    }


def format_timestamp(seconds: float | None) -> str:
    value = float(seconds or 0.0)
    minutes, remaining_seconds = divmod(value, 60)

    return f"{int(minutes):02d}:{remaining_seconds:05.2f}"


def render_text_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    metrics = report["metrics_comparison"]
    lines = [
        "EchoNote turbo / large-v3 오전사 후보 비교",
        "",
        f"전체 의심 후보: {summary['candidate_count']}건",
        f"large-v3 대응 성공: {summary['covered_candidate_count']}건",
        f"직접 시간 중첩: {summary['direct_overlap_count']}건",
        f"근접 시간 추정: {summary['nearest_match_count']}건",
        f"모델 결과 다름: {summary['model_disagreement_count']}건",
        f"모델 결과 같음: {summary['model_agreement_count']}건",
        f"타임스탬프 모호: {summary['ambiguous_alignment_count']}건",
        f"turbo CER: {metrics['turbo_cer_percent']:.2f}%",
        f"large-v3 CER: {metrics['large_v3_cer_percent']:.2f}%",
        f"turbo WER: {metrics['turbo_wer_percent']:.2f}%",
        f"large-v3 WER: {metrics['large_v3_wer_percent']:.2f}%",
        "",
        f"우선 검토 후보 {summary['priority_preview_count']}건",
        "",
    ]

    for candidate in report["priority_candidates"]:
        lines.extend(
            [
                f"[{candidate['candidate_id']}] {format_timestamp(candidate['start'])}",
                f"turbo: {candidate['turbo_word']} (신뢰도 {candidate['probability']:.4f})",
                f"large-v3: {candidate['large_v3_words'] or '[대응 없음]'}",
                f"대응 방식: {candidate['alignment_method']}"
                f"{' (모호)' if candidate['alignment_ambiguous'] else ''}",
                f"turbo 문맥: {candidate['turbo_segment_text']}",
                f"large-v3 문맥: {candidate['large_v3_segment_text'] or '[대응 없음]'}",
                "",
            ],
        )

    return "\n".join(lines).rstrip() + "\n"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def run_comparison(
    *,
    turbo_directory: Path,
    large_v3_directory: Path,
    output_directory: Path,
    expected_candidate_count: int | None = None,
) -> dict[str, Any]:
    report = build_report(
        turbo_segments=read_json(turbo_directory / "segments.json"),
        large_v3_segments=read_json(large_v3_directory / "segments.json"),
        turbo_metrics=read_json(turbo_directory / "metrics.json"),
        large_v3_metrics=read_json(large_v3_directory / "metrics.json"),
        expected_candidate_count=expected_candidate_count,
    )
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / "candidate-comparison.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_directory / "candidate-review.txt").write_text(
        render_text_report(report),
        encoding="utf-8",
    )

    return report


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare turbo candidates with large-v3 output.")
    parser.add_argument("--turbo-dir", type=Path, required=True)
    parser.add_argument("--large-v3-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--expected-candidates", type=int)

    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    report = run_comparison(
        turbo_directory=arguments.turbo_dir,
        large_v3_directory=arguments.large_v3_dir,
        output_directory=arguments.output_dir,
        expected_candidate_count=arguments.expected_candidates,
    )

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
