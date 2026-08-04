# faster-whisper turbo / large-v3 전사 품질 벤치마크

> **종료된 비교 실험**: 이 도구는 `large-v3` 채택 여부를 판단하기 위한 과거 벤치마크다.
> 현재 제품은 `large-v3-turbo` 전사와 Gemma 오전사 후보 제안을 사용하며 `large-v3` 재전사를 수행하지 않는다.
> 제품 구현·운영 기준은 `docs/superpowers/specs/2026-08-04-echonote-rn-first-architecture-design.md`다.

Windows 11 + Docker Desktop + NVIDIA RTX 5070 Ti에서 `faster-whisper`의 `turbo`와 `large-v3`를 순서대로 실행한다. 각 모델을 클로바 전사문과 비교하고, `turbo` 단어 신뢰도가 `0.5` 미만인 오전사 의심 후보를 `large-v3` 결과와 타임스탬프로 대응시킨다.

이번 품질 시험에서는 기존 샘플의 후보 224건을 빠짐없이 검증하고 두 모델의 전체 CER/WER도 비교하기 위해 `large-v3`로 전체 음성을 한 번 전사했다. 결과상 보조 재전사 이득이 제한적이어서 제품 운영 경로에서는 제외했다.

## 고정 환경

- CUDA `12.8.1` + cuDNN runtime
- `faster-whisper==1.2.1`
- `CTranslate2==4.8.1`
- 모델 `turbo`, `large-v3`
- GPU `float16`
- 언어 `ko`
- `beam_size=5`
- VAD와 단어 타임스탬프 활성화
- 용어 힌트 미사용

## 입력 준비

이 폴더 전체를 Windows의 다음 경로로 복사한다.

```text
C:\echonote-benchmark
```

그다음 `input` 폴더를 만들고 오디오 1개와 클로바 TXT 1개만 넣는다. 파일명은 자유다.

```text
C:\echonote-benchmark\input\회의 녹음.m4a
C:\echonote-benchmark\input\클로바 전사.txt
```

지원 오디오 확장자:

```text
.m4a .mp3 .wav .mp4 .aac .flac .ogg .opus .webm
```

## 실행

PowerShell에서 실행한다.

```powershell
cd C:\echonote-benchmark
powershell -ExecutionPolicy Bypass -File .\run-benchmark.ps1
```

첫 실행에서는 CUDA 이미지, Python 패키지, `turbo`, `large-v3` 모델을 다운로드하므로 시간이 더 걸린다. 이후 실행에서는 다음 Docker volume의 모델을 재사용한다.

```text
echonote-stt-benchmark-turbo-cache-v1
echonote-stt-benchmark-large-v3-cache-v1
```

모델 다운로드가 끝난 뒤 오디오, TXT, 모델 volume을 각각 읽기 전용으로 마운트한다. 두 모델은 별도 컨테이너에서 순차 실행되므로 GPU에 동시에 적재되지 않는다. 실제 전사와 후보 비교 컨테이너는 `--network none`으로 실행된다. `.dockerignore`가 모든 입력·출력 파일을 빌드 컨텍스트에서 제외하므로 녹음과 전사문은 Docker 이미지나 모델 volume에 복사되지 않는다.

## 결과

실행마다 별도 폴더가 생성된다.

```text
output\yyyyMMdd-HHmmss-fff-<guid8>\
├── .echonote-stt-benchmark-run
├── turbo\
│   ├── transcript.txt
│   ├── segments.json
│   └── metrics.json
├── large-v3\
│   ├── transcript.txt
│   ├── segments.json
│   └── metrics.json
└── comparison\
    ├── candidate-comparison.json
    └── candidate-review.txt
```

`output` 루트에도 정리 작업의 소유권 확인에 쓰는 `.echonote-stt-benchmark-output-root` 파일이 생성된다. 두 표식 파일은 벤치마크 결과가 아니므로 분석 대상에서 제외한다.

각 모델의 `metrics.json` 주요 항목:

- `cer`, `wer`: 치환·삭제·삽입·오류율
- `timing_seconds`: 모델 로드, 전사, 전체 시간, 실시간 배율
- `gpu_memory_mib`: 시작 VRAM, 최고 VRAM, 증가량
- `versions`: 실제 설치된 faster-whisper와 CTranslate2 버전

CER/WER의 기준은 사람이 검수한 정답이 아니라 클로바 결과다. 따라서 수치는 절대 정확도가 아니라 클로바 결과와의 일치도를 뜻한다. 화자 분리는 이번 시험 범위에 포함하지 않는다.

`candidate-comparison.json`에는 전체 후보와 두 모델의 CER/WER 차이가 들어간다. 이번 샘플은 후보가 정확히 224건이 아니면 비교 단계가 실패한다. 후보와 `large-v3` 단어는 최소 50% 이상 시간 중첩될 때 직접 대응하고, 직접 중첩이 없으면 0.4초 이내 최근접 결과를 모호한 대응으로 따로 집계한다. `candidate-review.txt`에는 신뢰도가 가장 낮은 상위 20건을 시간, `turbo` 단어, `large-v3` 대응 표현, 양쪽 문맥과 함께 표시한다. 모델 결과가 다르다는 사실은 오전사 가능성 신호이며 자동 교정의 근거로 사용하지 않는다.

## 정리

기본 정리는 벤치마크 소유권 label이 일치하는 벤치마크 이미지만 제거하고 두 모델 캐시와 결과는 보존한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\cleanup.ps1
```

벤치마크 모델 캐시와 개인정보가 포함된 결과도 제거하려면 명시적으로 옵션을 추가한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\cleanup.ps1 `
  -RemoveModelCache `
  -RemoveOutputs
```

결과 폴더는 이 벤치마크가 생성한 루트와 실행 폴더에 소유권 표식을 기록한다. `-RemoveOutputs`는 표식과 경로 형식을 모두 검증한 결과만 삭제하며, reparse point가 있으면 중단한다.

`cleanup.ps1`은 기존 `hermes` 컨테이너와 다른 작업이 공유할 수 있는 NVIDIA CUDA 기반 이미지를 변경하지 않는다.

`-RemoveOutputs`는 벤치마크의 `output`만 제거한다. 사용자가 넣은 `input` 원본, Windows `Downloads`의 실행 ZIP·로그·결과 ZIP은 복구 가능성을 위해 자동 삭제하지 않는다. 분석 완료 후 사용자가 직접 보관 또는 삭제해야 한다.
