import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from types import ModuleType
from types import SimpleNamespace
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("benchmark.py")
RUN_SCRIPT_PATH = Path(__file__).with_name("run-benchmark.ps1")
CLEANUP_SCRIPT_PATH = Path(__file__).with_name("cleanup.ps1")
DOCKERIGNORE_PATH = Path(__file__).with_name(".dockerignore")
COMPARISON_SCRIPT_PATH = Path(__file__).with_name("compare_candidates.py")


def load_benchmark_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("echonote_stt_benchmark", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


class BenchmarkModuleTest(unittest.TestCase):
    def test_benchmark_module_exists(self) -> None:
        self.assertTrue(MODULE_PATH.is_file(), "benchmark.py가 필요합니다")


class ScriptConfigurationTest(unittest.TestCase):
    def test_powershell_scripts_are_ascii_for_windows_powershell_compatibility(self) -> None:
        for path in (RUN_SCRIPT_PATH, CLEANUP_SCRIPT_PATH):
            path.read_bytes().decode("ascii")

    def test_private_inputs_are_file_mounted_after_offline_model_download(self) -> None:
        script = RUN_SCRIPT_PATH.read_text(encoding="ascii")
        gpu_stage_marker = 'Write-Host "[2/7] Check CTranslate2 GPU availability"'
        turbo_download_marker = 'Write-Host "[3/7] Download turbo model without mounting private input"'
        turbo_run_marker = 'Write-Host "[4/7] Run offline turbo transcription"'
        large_download_marker = 'Write-Host "[5/7] Download large-v3 model without mounting private input"'
        large_run_marker = 'Write-Host "[6/7] Run offline large-v3 transcription"'
        comparison_marker = 'Write-Host "[7/7] Compare 224 low-confidence candidates"'

        self.assertIn(gpu_stage_marker, script)
        markers = [
            gpu_stage_marker,
            turbo_download_marker,
            turbo_run_marker,
            large_download_marker,
            large_run_marker,
            comparison_marker,
        ]

        for earlier, later in zip(markers, markers[1:]):
            self.assertLess(script.index(earlier), script.index(later))

        turbo_download_stage = script.split(turbo_download_marker, 1)[1].split(turbo_run_marker, 1)[0]
        turbo_run_stage = script.split(turbo_run_marker, 1)[1].split(large_download_marker, 1)[0]
        large_download_stage = script.split(large_download_marker, 1)[1].split(large_run_marker, 1)[0]
        large_run_stage = script.split(large_run_marker, 1)[1].split(comparison_marker, 1)[0]
        comparison_stage = script.split(comparison_marker, 1)[1]

        self.assertIn("download_model('turbo', output_dir='/model')", turbo_download_stage)
        self.assertIn("download_model('large-v3', output_dir='/model')", large_download_stage)

        for download_stage in (turbo_download_stage, large_download_stage):
            self.assertNotIn("type=bind", download_stage)
            self.assertNotIn("$ResolvedAudioPath", download_stage)
            self.assertNotIn("$ResolvedReferencePath", download_stage)

        for run_stage, model_name in ((turbo_run_stage, "turbo"), (large_run_stage, "large-v3")):
            self.assertIn('"--network", "none"', run_stage)
            self.assertIn('"--env", "HF_HUB_OFFLINE=1"', run_stage)
            self.assertIn('"--env", "ECHONOTE_WHISPER_MODEL_PATH=/model"', run_stage)
            self.assertIn(f'"--model", "{model_name}"', run_stage)
            self.assertIn(
                '"type=bind,source=$ResolvedAudioPath,target=$AudioContainerPath,readonly"',
                run_stage,
            )
            self.assertIn(
                '"type=bind,source=$ResolvedReferencePath,target=$ReferenceContainerPath,readonly"',
                run_stage,
            )
            self.assertNotIn("source=$ResolvedInputDirectory", run_stage)

        self.assertIn('"--network", "none"', comparison_stage)
        self.assertIn('"/app/compare_candidates.py"', comparison_stage)
        self.assertIn('"--expected-candidates", "224"', comparison_stage)
        self.assertNotIn("$ResolvedAudioPath", comparison_stage)
        self.assertNotIn("$ResolvedReferencePath", comparison_stage)

    def test_transfer_instructions_check_tailscale_exit_codes(self) -> None:
        instructions_path = Path(__file__).with_name("ECHONOTE-LARGE-V3-TEST.txt")
        instructions = instructions_path.read_text(encoding="ascii")

        self.assertGreaterEqual(instructions.count("tailscale file cp"), 2)
        self.assertGreaterEqual(instructions.count("$LASTEXITCODE"), 3)
        self.assertIn("Result transfer failed", instructions)
        self.assertIn('$ErrorActionPreference = "Stop"', instructions)

    def test_native_stderr_does_not_abort_benchmark_wrapper(self) -> None:
        instructions_path = Path(__file__).with_name("ECHONOTE-LARGE-V3-TEST.txt")
        instructions = instructions_path.read_text(encoding="ascii")
        benchmark_call = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Target\\run-benchmark.ps1"'

        continue_index = instructions.index('$ErrorActionPreference = "Continue"')
        benchmark_index = instructions.index(benchmark_call)
        restore_index = instructions.index(
            "$ErrorActionPreference = $PreviousErrorActionPreference",
        )

        self.assertLess(continue_index, benchmark_index)
        self.assertLess(benchmark_index, restore_index)
        self.assertIn("$PreviousErrorActionPreference = $ErrorActionPreference", instructions)

    def test_build_context_uses_an_explicit_allowlist(self) -> None:
        rules = DOCKERIGNORE_PATH.read_text(encoding="ascii").splitlines()

        self.assertEqual(rules[0], "*")
        self.assertEqual(
            set(rules[1:]),
            {"!benchmark.py", "!compare_candidates.py", "!requirements.txt", "!Dockerfile"},
        )

    def test_uses_separate_owned_model_caches(self) -> None:
        run_script = RUN_SCRIPT_PATH.read_text(encoding="ascii")
        cleanup_script = CLEANUP_SCRIPT_PATH.read_text(encoding="ascii")

        for script in (run_script, cleanup_script):
            self.assertIn("echonote-stt-benchmark-turbo-cache-v1", script)
            self.assertIn("echonote-stt-benchmark-large-v3-cache-v1", script)
            self.assertIn("stt-benchmark-turbo-model-cache-v1", script)
            self.assertIn("stt-benchmark-large-v3-model-cache-v1", script)

    def test_run_directory_uses_guid_and_cleanup_does_not_remove_shared_base_image(self) -> None:
        run_script = RUN_SCRIPT_PATH.read_text(encoding="ascii")
        cleanup_script = CLEANUP_SCRIPT_PATH.read_text(encoding="ascii")

        self.assertIn("[guid]::NewGuid()", run_script)
        self.assertNotIn("nvidia/cuda:", cleanup_script)
        self.assertNotIn("RemoveBaseImage", cleanup_script)

    def test_docker_label_inspection_uses_windows_safe_json_templates(self) -> None:
        run_script = RUN_SCRIPT_PATH.read_text(encoding="ascii")
        cleanup_script = CLEANUP_SCRIPT_PATH.read_text(encoding="ascii")

        self.assertIn('$ResourceLabel = "com.echonote.resource"', cleanup_script)

        for script in (run_script, cleanup_script):
            self.assertNotIn("{{ index", script)
            self.assertIn("'{{json .Config.Labels}}'", script)
            self.assertIn("'{{json .Labels}}'", script)
            self.assertGreaterEqual(script.count("ConvertFrom-Json"), 2)
            self.assertGreaterEqual(script.count("$Owner = $null"), 2)
            self.assertGreaterEqual(script.count("if ($null -ne $Labels)"), 2)
            self.assertGreaterEqual(
                script.count("$Labels.PSObject.Properties[$ResourceLabel]"),
                2,
            )
            self.assertGreaterEqual(
                script.count("$PreviousErrorActionPreference = $ErrorActionPreference"),
                2,
            )
            self.assertGreaterEqual(
                script.count('$ErrorActionPreference = "Continue"'),
                2,
            )
            self.assertGreaterEqual(
                script.count("$ErrorActionPreference = $PreviousErrorActionPreference"),
                2,
            )
            self.assertGreaterEqual(script.count("$InspectOutput = @(& docker"), 2)
            self.assertGreaterEqual(
                script.count("$InspectError = ($InspectOutput | Out-String).Trim()"),
                2,
            )
            self.assertIn("No such image", script)
            self.assertIn("No such volume", script)

    def test_output_cleanup_requires_owned_non_reparse_directories(self) -> None:
        run_script = RUN_SCRIPT_PATH.read_text(encoding="ascii")
        cleanup_script = CLEANUP_SCRIPT_PATH.read_text(encoding="ascii")

        for script in (run_script, cleanup_script):
            self.assertIn(
                '$OutputRootMarkerName = ".echonote-stt-benchmark-output-root"',
                script,
            )
            self.assertIn('$RunMarkerName = ".echonote-stt-benchmark-run"', script)
            self.assertIn("ReparsePoint", script)

        self.assertIn("$OutputRootOwner", run_script)
        self.assertIn("$RunId", run_script)
        self.assertIn("$OutputRootOwner", cleanup_script)
        self.assertIn("^\\d{8}-\\d{6}-\\d{3}-[0-9a-f]{8}$", cleanup_script)
        self.assertIn("Refusing to remove unowned output", cleanup_script)

    def test_cleanup_checks_docker_daemon_before_reporting_success(self) -> None:
        cleanup_script = CLEANUP_SCRIPT_PATH.read_text(encoding="ascii")
        daemon_check = 'Invoke-Docker -Arguments @("info")'
        first_removal = "Remove-OwnedImageIfPresent"
        inspect_failure_branches = re.findall(
            r"if \(\$InspectExitCode -ne 0\) \{(.*?)\n  \}",
            cleanup_script,
            flags=re.DOTALL,
        )

        self.assertIn(daemon_check, cleanup_script)
        self.assertLess(cleanup_script.rindex(daemon_check), cleanup_script.rindex(first_removal))
        self.assertEqual(len(inspect_failure_branches), 2)

        for branch in inspect_failure_branches:
            self.assertIn('-Arguments @("info")', branch)
            self.assertIn("return", branch)


class ClovaReferenceTest(unittest.TestCase):
    def test_removes_clova_header_speaker_markers_and_footer(self) -> None:
        benchmark = load_benchmark_module()
        strip_metadata = getattr(benchmark, "strip_clova_metadata", None)

        self.assertTrue(callable(strip_metadata), "strip_clova_metadata가 필요합니다")

        source = """샘플 회의
2030.01.02 수 오후 2:30 ・ 12분 34초
테스트 작성자


참석자 1 00:00
첫 문장입니다.

참석자 2 01:23
둘째 문장입니다.


clovanote.naver.com
"""

        self.assertEqual(strip_metadata(source), "첫 문장입니다.\n둘째 문장입니다.")

    def test_preserves_plain_transcript_without_clova_header(self) -> None:
        benchmark = load_benchmark_module()
        strip_metadata = getattr(benchmark, "strip_clova_metadata", None)

        self.assertTrue(callable(strip_metadata), "strip_clova_metadata가 필요합니다")
        self.assertEqual(strip_metadata("첫 문장\n둘째 문장\n"), "첫 문장\n둘째 문장")


class TextNormalizationTest(unittest.TestCase):
    def test_normalizes_characters_for_korean_cer(self) -> None:
        benchmark = load_benchmark_module()
        normalize = getattr(benchmark, "normalize_for_cer", None)

        self.assertTrue(callable(normalize), "normalize_for_cer가 필요합니다")
        self.assertEqual(normalize("Ｂ2Ｃ, 개인 정보!\n보호"), "b2c개인정보보호")

    def test_normalizes_words_for_korean_wer(self) -> None:
        benchmark = load_benchmark_module()
        normalize = getattr(benchmark, "normalize_for_wer", None)

        self.assertTrue(callable(normalize), "normalize_for_wer가 필요합니다")
        self.assertEqual(normalize("Ｂ2Ｃ, 개인 정보!\n보호"), ["b2c", "개인", "정보", "보호"])


class ErrorRateTest(unittest.TestCase):
    def test_counts_substitution_and_insertion(self) -> None:
        benchmark = load_benchmark_module()
        calculate = getattr(benchmark, "calculate_error_stats", None)

        self.assertTrue(callable(calculate), "calculate_error_stats가 필요합니다")

        result = calculate(
            ["오늘", "회의", "시작"],
            ["오늘", "미팅", "곧", "시작"],
        )

        self.assertEqual(result["substitutions"], 1)
        self.assertEqual(result["deletions"], 0)
        self.assertEqual(result["insertions"], 1)
        self.assertEqual(result["distance"], 2)
        self.assertEqual(result["reference_length"], 3)
        self.assertAlmostEqual(result["rate"], 2 / 3)
        self.assertAlmostEqual(result["percent"], 200 / 3)

    def test_handles_empty_reference(self) -> None:
        benchmark = load_benchmark_module()
        calculate = getattr(benchmark, "calculate_error_stats", None)

        self.assertTrue(callable(calculate), "calculate_error_stats가 필요합니다")
        self.assertEqual(calculate([], ["추가"])["rate"], 1.0)
        self.assertEqual(calculate([], [])["rate"], 0.0)

    def test_counts_deletion(self) -> None:
        benchmark = load_benchmark_module()
        calculate = getattr(benchmark, "calculate_error_stats", None)

        self.assertTrue(callable(calculate), "calculate_error_stats가 필요합니다")

        result = calculate(["오늘", "회의", "시작"], ["오늘", "시작"])

        self.assertEqual(result["substitutions"], 0)
        self.assertEqual(result["deletions"], 1)
        self.assertEqual(result["insertions"], 0)
        self.assertEqual(result["distance"], 1)
        self.assertAlmostEqual(result["rate"], 1 / 3)

    def test_calculates_cer_and_wer_together(self) -> None:
        benchmark = load_benchmark_module()
        calculate = getattr(benchmark, "calculate_transcript_metrics", None)

        self.assertTrue(callable(calculate), "calculate_transcript_metrics가 필요합니다")

        result = calculate("오늘 회의 시작", "오늘 미팅 시작")

        self.assertEqual(result["cer"]["reference_length"], 6)
        self.assertEqual(result["cer"]["substitutions"], 2)
        self.assertAlmostEqual(result["cer"]["rate"], 2 / 6)
        self.assertEqual(result["wer"]["reference_length"], 3)
        self.assertEqual(result["wer"]["substitutions"], 1)
        self.assertAlmostEqual(result["wer"]["rate"], 1 / 3)


class FakeGpuMemorySampler:
    def __init__(self) -> None:
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def stats(self) -> dict[str, int]:
        return {
            "baseline": 1161,
            "peak": 5000,
            "peak_delta": 3839,
        }


class StepTimer:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        self.value += 1.0

        return self.value


class BenchmarkRunTest(unittest.TestCase):
    def test_runs_gpu_transcription_and_writes_all_outputs(self) -> None:
        benchmark = load_benchmark_module()
        run_benchmark = getattr(benchmark, "run_benchmark", None)

        self.assertTrue(callable(run_benchmark), "run_benchmark가 필요합니다")

        model_factory_calls: list[tuple[str, str, str]] = []
        transcribe_calls: list[dict[str, object]] = []
        segments = [
            SimpleNamespace(
                id=0,
                start=0.0,
                end=1.2,
                text=" 안녕하세요",
                avg_logprob=-0.2,
                no_speech_prob=0.01,
                words=[
                    SimpleNamespace(start=0.0, end=1.2, word="안녕하세요", probability=0.98),
                ],
            ),
            SimpleNamespace(
                id=1,
                start=1.2,
                end=2.5,
                text=" 회의를 시작합니다",
                avg_logprob=-0.1,
                no_speech_prob=0.02,
                words=None,
            ),
        ]
        info = SimpleNamespace(
            language="ko",
            language_probability=0.99,
            duration=100.0,
            duration_after_vad=95.0,
        )

        class FakeModel:
            def transcribe(self, audio_path: str, **kwargs: object):
                transcribe_calls.append({"audio_path": audio_path, **kwargs})

                return iter(segments), info

        def model_factory(model_name: str, *, device: str, compute_type: str) -> FakeModel:
            model_factory_calls.append((model_name, device, compute_type))

            return FakeModel()

        sampler = FakeGpuMemorySampler()

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            audio_path = root / "회의 녹음.m4a"
            reference_path = root / "클로바 전사.txt"
            output_directory = root / "output"
            audio_path.write_bytes(b"test")
            reference_path.write_text(
                "회의 제목\n참석자 1 00:00\n안녕하세요. 회의를 시작합니다.\nclovanote.naver.com\n",
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {"ECHONOTE_WHISPER_MODEL_PATH": "/model"},
            ):
                result = run_benchmark(
                    audio_path=audio_path,
                    reference_path=reference_path,
                    output_directory=output_directory,
                    model_factory=model_factory,
                    timer=StepTimer(),
                    gpu_memory_sampler=sampler,
                )

            transcript = (output_directory / "transcript.txt").read_text(encoding="utf-8")
            segment_payload = json.loads(
                (output_directory / "segments.json").read_text(encoding="utf-8"),
            )
            metric_payload = json.loads(
                (output_directory / "metrics.json").read_text(encoding="utf-8"),
            )

        self.assertEqual(model_factory_calls, [("/model", "cuda", "float16")])
        self.assertEqual(transcribe_calls[0]["language"], "ko")
        self.assertEqual(transcribe_calls[0]["beam_size"], 5)
        self.assertTrue(transcribe_calls[0]["vad_filter"])
        self.assertTrue(transcribe_calls[0]["word_timestamps"])
        self.assertIn("initial_prompt", transcribe_calls[0])
        self.assertIsNone(transcribe_calls[0]["initial_prompt"])
        self.assertEqual(transcript, "안녕하세요\n회의를 시작합니다\n")
        self.assertEqual(segment_payload[0]["words"][0]["probability"], 0.98)
        self.assertEqual(segment_payload[1]["words"], [])
        self.assertEqual(metric_payload["configuration"]["model"], "turbo")
        self.assertEqual(metric_payload["gpu_memory_mib"]["peak_delta"], 3839)
        self.assertEqual(metric_payload["cer"]["distance"], 0)
        self.assertEqual(metric_payload["wer"]["distance"], 0)
        self.assertEqual(result, metric_payload)
        self.assertTrue(sampler.started)
        self.assertTrue(sampler.stopped)

    def test_records_requested_model_name(self) -> None:
        benchmark = load_benchmark_module()
        run_benchmark = getattr(benchmark, "run_benchmark")
        model_factory_calls: list[tuple[str, str, str]] = []
        info = SimpleNamespace(
            language="ko",
            language_probability=1.0,
            duration=1.0,
            duration_after_vad=1.0,
        )

        class FakeModel:
            def transcribe(self, audio_path: str, **kwargs: object):
                return iter([]), info

        def model_factory(model_name: str, *, device: str, compute_type: str) -> FakeModel:
            model_factory_calls.append((model_name, device, compute_type))

            return FakeModel()

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            audio_path = root / "audio.m4a"
            reference_path = root / "reference.txt"
            audio_path.write_bytes(b"test")
            reference_path.write_text("", encoding="utf-8")

            result = run_benchmark(
                audio_path=audio_path,
                reference_path=reference_path,
                output_directory=root / "output",
                model_name="large-v3",
                model_factory=model_factory,
                timer=StepTimer(),
                gpu_memory_sampler=FakeGpuMemorySampler(),
            )

        self.assertEqual(model_factory_calls, [("large-v3", "cuda", "float16")])
        self.assertEqual(result["configuration"]["model"], "large-v3")


if __name__ == "__main__":
    unittest.main()
