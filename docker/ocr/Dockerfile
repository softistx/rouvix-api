# syntax=docker/dockerfile:1.10
# rouvix-ocr: the local OCR of rouvix-api (spec §3, §4.2), Tesseract with its
# French and English models behind one HTTP route (server.ts). It runs on the
# stack's internal network alone: no egress, no published port, so an ID
# document's photo cannot leave the machine through it. Bun is pinned with the
# API's own (Dockerfile at the root). Build: `docker build -t rouvix-ocr docker/ocr`.
FROM oven/bun:1.4.4-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-fra tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.ts ./
ENV PORT=8884 OMP_THREAD_LIMIT=1
USER bun
EXPOSE 8884
# Bash only (no Bun process per check): one HTTP/1.0 request on /health, every 30 s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8884} && printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q ' 200 '"]
CMD ["bun", "server.ts"]
