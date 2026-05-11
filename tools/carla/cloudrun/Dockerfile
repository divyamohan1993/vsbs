# VSBS chaos-driver Cloud Run image.
# Build context: tools/carla/  (i.e. `gcloud builds submit tools/carla ...`).
# Strictly synthetic: no CARLA, no Unreal, no Vulkan, no GPU.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY cloudrun/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY vsbs_carla /app/vsbs_carla
COPY cloudrun/server.py /app/server.py

ENV PYTHONPATH=/app

RUN groupadd --system --gid 65532 vsbs \
 && useradd  --system --uid 65532 --gid vsbs --no-create-home vsbs
USER 65532:65532

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips=*"]
