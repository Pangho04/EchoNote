FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

LABEL com.echonote.resource="stt-benchmark-image-v1"

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

COPY benchmark.py ./
COPY compare_candidates.py ./

ENTRYPOINT ["python3", "/app/benchmark.py"]
