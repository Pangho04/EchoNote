# Worker가 job마다 실행하는 STT 이미지다. 모델은 이미지에 넣지 않고 volume으로 읽기 전용 연결한다.
# 저장소 루트에서 이미지를 만든다.
#   docker build -t echonote-stt:v1 services/inference-worker/stt
# 모델을 volume 루트(/model/model.bin)에 한 번 받는다. 이 컨테이너만 인터넷을 쓰고 volume에 쓴다.
#   docker run --rm --mount type=volume,source=echonote-stt-large-v3-turbo-v1,target=/model --entrypoint python3 echonote-stt:v1 -c "from faster_whisper.utils import download_model; download_model('large-v3-turbo', output_dir='/model')"
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

LABEL com.echonote.resource="stt-image-v1"

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates python3 python3-pip \
    && mkdir --parents /input /output \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --requirement requirements.txt

COPY transcribe.py ./

ENTRYPOINT ["python3", "/app/transcribe.py"]
