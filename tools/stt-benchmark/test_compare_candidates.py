import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest


MODULE_PATH = Path(__file__).with_name("compare_candidates.py")


def load_comparison_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("echonote_candidate_comparison", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


class CandidateExtractionTest(unittest.TestCase):
    def test_extracts_only_words_below_threshold(self) -> None:
        comparison = load_comparison_module()
        segments = [
            {
                "id": 3,
                "start": 10.0,
                "end": 13.0,
                "text": "개인 정보 보호 검토",
                "words": [
                    {"start": 10.0, "end": 10.5, "word": "개인", "probability": 0.91},
                    {"start": 10.5, "end": 11.0, "word": "정보", "probability": 0.49},
                    {"start": 11.0, "end": 11.5, "word": "보호", "probability": 0.5},
                    {"start": 11.5, "end": 12.0, "word": "검토", "probability": None},
                ],
            },
        ]

        candidates = comparison.extract_candidates(segments, threshold=0.5)

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["turbo_word"], "정보")
        self.assertEqual(candidates[0]["turbo_segment_text"], "개인 정보 보호 검토")
        self.assertEqual(candidates[0]["probability"], 0.49)


class CandidateAlignmentTest(unittest.TestCase):
    def test_attaches_large_v3_words_and_context_by_timestamp(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 10.5,
                "end": 11.0,
                "turbo_word": "삼성아재",
                "probability": 0.2,
                "turbo_segment_id": 3,
                "turbo_segment_text": "삼성아재에서 전달받았습니다",
            },
        ]
        large_segments = [
            {
                "id": 7,
                "start": 9.5,
                "end": 12.5,
                "text": "삼성화재에서 전달받았습니다",
                "words": [
                    {"start": 10.4, "end": 11.1, "word": "삼성화재에서", "probability": 0.94},
                    {"start": 11.1, "end": 12.0, "word": "전달받았습니다", "probability": 0.98},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertEqual(aligned[0]["large_v3_words"], "삼성화재에서")
        self.assertEqual(aligned[0]["large_v3_segment_text"], "삼성화재에서 전달받았습니다")
        self.assertTrue(aligned[0]["has_large_v3_match"])
        self.assertTrue(aligned[0]["has_direct_overlap"])
        self.assertTrue(aligned[0]["model_disagreement"])

    def test_marks_same_normalized_word_as_agreement(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 2.0,
                "end": 2.5,
                "turbo_word": "개인정보",
                "probability": 0.1,
                "turbo_segment_id": 1,
                "turbo_segment_text": "개인정보",
            },
        ]
        large_segments = [
            {
                "id": 2,
                "start": 1.5,
                "end": 3.0,
                "text": "개인 정보",
                "words": [
                    {"start": 1.9, "end": 2.2, "word": "개인", "probability": 0.9},
                    {"start": 2.2, "end": 2.6, "word": "정보", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.2)

        self.assertFalse(aligned[0]["model_disagreement"])

    def test_combines_split_word_across_segment_boundary(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 2.0,
                "end": 2.6,
                "turbo_word": "개인정보",
                "probability": 0.1,
                "turbo_segment_id": 1,
                "turbo_segment_text": "개인정보",
            },
        ]
        large_segments = [
            {
                "id": 2,
                "start": 1.8,
                "end": 2.3,
                "text": "개인",
                "words": [
                    {"start": 2.0, "end": 2.3, "word": "개인", "probability": 0.9},
                ],
            },
            {
                "id": 3,
                "start": 2.3,
                "end": 2.8,
                "text": "정보",
                "words": [
                    {"start": 2.3, "end": 2.6, "word": "정보", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertEqual(aligned[0]["large_v3_words"], "개인 정보")
        self.assertEqual(aligned[0]["large_v3_segment_ids"], [2, 3])
        self.assertFalse(aligned[0]["model_disagreement"])

    def test_does_not_include_neighboring_words_within_tolerance(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 4.0,
                "end": 4.4,
                "turbo_word": "보호",
                "probability": 0.1,
                "turbo_segment_id": 1,
                "turbo_segment_text": "정보 보호 검토",
            },
        ]
        large_segments = [
            {
                "id": 2,
                "start": 3.0,
                "end": 5.0,
                "text": "정보 보호 검토",
                "words": [
                    {"start": 3.6, "end": 4.0, "word": "정보", "probability": 0.9},
                    {"start": 4.0, "end": 4.4, "word": "보호", "probability": 0.9},
                    {"start": 4.4, "end": 4.8, "word": "검토", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertEqual(aligned[0]["large_v3_words"], "보호")
        self.assertFalse(aligned[0]["model_disagreement"])

    def test_ignores_neighbor_with_only_tiny_timestamp_overlap(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 4.0,
                "end": 4.4,
                "turbo_word": "보호",
                "probability": 0.1,
                "turbo_segment_id": 1,
                "turbo_segment_text": "정보 보호 검토",
            },
        ]
        large_segments = [
            {
                "id": 2,
                "start": 3.0,
                "end": 5.0,
                "text": "정보 보호 검토",
                "words": [
                    {"start": 3.6, "end": 4.01, "word": "정보", "probability": 0.9},
                    {"start": 4.01, "end": 4.39, "word": "보호", "probability": 0.9},
                    {"start": 4.39, "end": 4.8, "word": "검토", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertEqual(aligned[0]["large_v3_words"], "보호")
        self.assertFalse(aligned[0]["model_disagreement"])

    def test_prefers_segment_with_greatest_word_overlap(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 5.0,
                "end": 5.2,
                "turbo_word": "이걸",
                "probability": 0.1,
                "turbo_segment_id": 2,
                "turbo_segment_text": "이걸 확인",
            },
        ]
        large_segments = [
            {
                "id": 1,
                "start": 4.8,
                "end": 5.2,
                "text": "상처를",
                "words": [
                    {"start": 5.0, "end": 5.1, "word": "상처를", "probability": 0.9},
                ],
            },
            {
                "id": 2,
                "start": 5.0,
                "end": 6.0,
                "text": "이걸 확인",
                "words": [
                    {"start": 5.0, "end": 5.2, "word": "이걸", "probability": 0.9},
                    {"start": 5.2, "end": 5.6, "word": "확인", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertEqual(aligned[0]["large_v3_words"], "이걸")
        self.assertEqual(aligned[0]["large_v3_segment_id"], 2)
        self.assertFalse(aligned[0]["model_disagreement"])

    def test_marks_zero_duration_alignment_as_ambiguous(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": 5.0,
                "end": 5.0,
                "turbo_word": "진행이",
                "probability": 0.1,
                "turbo_segment_id": 2,
                "turbo_segment_text": "진행이 안 되겠군",
            },
        ]
        large_segments = [
            {
                "id": 3,
                "start": 5.0,
                "end": 5.4,
                "text": "진행이 안 되겠군",
                "words": [
                    {"start": 5.0, "end": 5.0, "word": "진행이", "probability": 0.9},
                    {"start": 5.0, "end": 5.0, "word": "안", "probability": 0.9},
                    {"start": 5.0, "end": 5.4, "word": "되겠군", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertTrue(aligned[0]["alignment_ambiguous"])
        self.assertIsNone(aligned[0]["model_disagreement"])

    def test_does_not_map_missing_timestamp_to_start_of_audio(self) -> None:
        comparison = load_comparison_module()
        candidates = [
            {
                "candidate_id": 1,
                "start": None,
                "end": None,
                "turbo_word": "누락",
                "probability": 0.1,
                "turbo_segment_id": 2,
                "turbo_segment_text": "누락",
            },
        ]
        large_segments = [
            {
                "id": 3,
                "start": 0.0,
                "end": 1.0,
                "text": "시작",
                "words": [
                    {"start": 0.0, "end": 1.0, "word": "시작", "probability": 0.9},
                ],
            },
        ]

        aligned = comparison.align_candidates(candidates, large_segments, tolerance_seconds=0.4)

        self.assertFalse(aligned[0]["has_large_v3_match"])
        self.assertFalse(aligned[0]["has_direct_overlap"])
        self.assertEqual(aligned[0]["alignment_method"], "unmatched")
        self.assertIsNone(aligned[0]["model_disagreement"])


class ComparisonReportTest(unittest.TestCase):
    def test_writes_all_candidates_and_limits_priority_preview_to_twenty(self) -> None:
        comparison = load_comparison_module()
        turbo_segments = [
            {
                "id": index,
                "start": float(index),
                "end": float(index) + 0.5,
                "text": f"후보 {index}",
                "words": [
                    {
                        "start": float(index),
                        "end": float(index) + 0.5,
                        "word": f"후보{index}",
                        "probability": index / 100,
                    },
                ],
            }
            for index in range(25)
        ]
        large_segments = [
            {
                "id": index,
                "start": float(index),
                "end": float(index) + 0.5,
                "text": f"대안 {index}",
                "words": [
                    {
                        "start": float(index),
                        "end": float(index) + 0.5,
                        "word": f"대안{index}",
                        "probability": 0.9,
                    },
                ],
            }
            for index in range(25)
        ]
        turbo_metrics = {
            "cer": {"percent": 14.8},
            "wer": {"percent": 29.2},
            "timing_seconds": {"transcription": 41.0},
            "gpu_memory_mib": {"peak": 3935},
        }
        large_metrics = {
            "cer": {"percent": 12.0},
            "wer": {"percent": 25.0},
            "timing_seconds": {"transcription": 100.0},
            "gpu_memory_mib": {"peak": 6000},
        }

        report = comparison.build_report(
            turbo_segments=turbo_segments,
            large_v3_segments=large_segments,
            turbo_metrics=turbo_metrics,
            large_v3_metrics=large_metrics,
            threshold=0.5,
            preview_limit=20,
        )

        self.assertEqual(report["summary"]["candidate_count"], 25)
        self.assertEqual(report["summary"]["covered_candidate_count"], 25)
        self.assertEqual(report["summary"]["direct_overlap_count"], 25)
        self.assertEqual(report["summary"]["nearest_match_count"], 0)
        self.assertEqual(report["summary"]["priority_preview_count"], 20)
        self.assertEqual(len(report["priority_candidates"]), 20)
        self.assertEqual(len(report["all_candidates"]), 25)
        self.assertAlmostEqual(report["metrics_comparison"]["cer_delta_percentage_points"], -2.8)
        self.assertAlmostEqual(report["metrics_comparison"]["wer_delta_percentage_points"], -4.2)
        self.assertEqual(report["configuration"]["expected_candidate_count"], None)
        self.assertEqual(report["configuration"]["minimum_overlap_ratio"], 0.5)

    def test_cli_writes_json_and_readable_text_report(self) -> None:
        comparison = load_comparison_module()

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            turbo_directory = root / "turbo"
            large_directory = root / "large-v3"
            output_directory = root / "comparison"
            turbo_directory.mkdir()
            large_directory.mkdir()
            turbo_segments = [
                {
                    "id": 1,
                    "start": 1.0,
                    "end": 2.0,
                    "text": "오전사",
                    "words": [
                        {"start": 1.0, "end": 2.0, "word": "오전사", "probability": 0.1},
                    ],
                },
            ]
            large_segments = [
                {
                    "id": 1,
                    "start": 1.0,
                    "end": 2.0,
                    "text": "오전사 후보",
                    "words": [
                        {"start": 1.0, "end": 2.0, "word": "후보", "probability": 0.9},
                    ],
                },
            ]
            metrics = {
                "cer": {"percent": 1.0},
                "wer": {"percent": 2.0},
                "timing_seconds": {"transcription": 3.0},
                "gpu_memory_mib": {"peak": 4},
            }
            (turbo_directory / "segments.json").write_text(
                json.dumps(turbo_segments, ensure_ascii=False),
                encoding="utf-8",
            )
            (large_directory / "segments.json").write_text(
                json.dumps(large_segments, ensure_ascii=False),
                encoding="utf-8",
            )
            (turbo_directory / "metrics.json").write_text(
                json.dumps(metrics),
                encoding="utf-8",
            )
            (large_directory / "metrics.json").write_text(
                json.dumps(metrics),
                encoding="utf-8",
            )

            comparison.run_comparison(
                turbo_directory=turbo_directory,
                large_v3_directory=large_directory,
                output_directory=output_directory,
            )

            report = json.loads((output_directory / "candidate-comparison.json").read_text(encoding="utf-8"))
            readable_report = (output_directory / "candidate-review.txt").read_text(encoding="utf-8")

        self.assertEqual(report["summary"]["candidate_count"], 1)
        self.assertIn("우선 검토 후보 1건", readable_report)
        self.assertIn("오전사", readable_report)
        self.assertIn("후보", readable_report)
        self.assertIn("대응 방식:", readable_report)

    def test_rejects_unexpected_candidate_count(self) -> None:
        comparison = load_comparison_module()

        with self.assertRaisesRegex(ValueError, "Expected 224 candidates, found 0"):
            comparison.build_report(
                turbo_segments=[],
                large_v3_segments=[],
                turbo_metrics={
                    "cer": {"percent": 0.0},
                    "wer": {"percent": 0.0},
                    "timing_seconds": {"transcription": 0.0},
                    "gpu_memory_mib": {"peak": 0},
                },
                large_v3_metrics={
                    "cer": {"percent": 0.0},
                    "wer": {"percent": 0.0},
                    "timing_seconds": {"transcription": 0.0},
                    "gpu_memory_mib": {"peak": 0},
                },
                expected_candidate_count=224,
            )


if __name__ == "__main__":
    unittest.main()
