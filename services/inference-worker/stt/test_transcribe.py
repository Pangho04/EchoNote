import importlib.util
import json
import math
from pathlib import Path
import sys
import tempfile
from types import ModuleType
from types import SimpleNamespace
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("transcribe.py")


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("echonote_stt_transcribe", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    return module


transcribe = load_module()


def segment(start: float, end: float, text: str) -> SimpleNamespace:
    return SimpleNamespace(start=start, end=end, text=text)


class BuildResultTest(unittest.TestCase):
    def test_rounds_seconds_to_integer_ms(self) -> None:
        result = transcribe.build_result(2.0004, [segment(0.0014, 1.2346, " 안녕하세요 ")])

        self.assertEqual(
            result,
            {
                "schemaVersion": 1,
                "durationMs": 2000,
                "segments": [{"startMs": 1, "endMs": 1235, "text": "안녕하세요"}],
            },
        )

    def test_drops_blank_text(self) -> None:
        result = transcribe.build_result(
            1.0,
            [
                segment(0.0, 0.5, "  "),
                segment(0.2, 0.4, " \ufeff "),
                segment(0.5, 1.0, "\ufeff네"),
            ],
        )

        self.assertEqual(result["segments"], [{"startMs": 500, "endMs": 1000, "text": "네"}])

    def test_clamps_end_before_start_and_past_duration(self) -> None:
        result = transcribe.build_result(
            1.0,
            [segment(0.4, 0.3, "역순"), segment(0.9, 1.5, "넘침"), segment(1.2, 1.4, "밖")],
        )

        self.assertEqual(
            result["segments"],
            [
                {"startMs": 400, "endMs": 400, "text": "역순"},
                {"startMs": 900, "endMs": 1000, "text": "넘침"},
                {"startMs": 1000, "endMs": 1000, "text": "밖"},
            ],
        )

    def test_allows_zero_segments(self) -> None:
        self.assertEqual(transcribe.build_result(0.0, [])["segments"], [])


class WriteResultTest(unittest.TestCase):
    def test_writes_json_without_leaving_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            transcribe.write_result(path, {"schemaVersion": 1, "segments": [{"text": "한글"}]})

            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["segments"][0]["text"], "한글")
            self.assertEqual([entry.name for entry in Path(directory).iterdir()], ["result.json"])

    def test_rejects_nan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                transcribe.write_result(Path(directory) / "result.json", {"durationMs": math.nan})


class MainTest(unittest.TestCase):
    def test_self_check_exit_codes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)

            for gpu_count, has_model, expected in [(0, True, 10), (1, False, 11), (1, True, 0)]:
                if has_model:
                    (model_path / "model.bin").write_bytes(b"")

                fake_ctranslate2 = SimpleNamespace(get_cuda_device_count=lambda: gpu_count)

                with (
                    patch.dict(sys.modules, {"ctranslate2": fake_ctranslate2}),
                    patch.object(transcribe, "MODEL_PATH", model_path),
                ):
                    self.assertEqual(transcribe.main(["--self-check"]), expected)

                (model_path / "model.bin").unlink(missing_ok=True)

    def test_rejects_unknown_arguments(self) -> None:
        self.assertEqual(transcribe.main(["--other"]), 2)


if __name__ == "__main__":
    unittest.main()
