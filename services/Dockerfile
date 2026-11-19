FROM ghcr.io/astral-sh/uv:0.12.3 AS uv
FROM python:3.12.16-slim-bookworm AS build

ARG SERVICE
WORKDIR /app
COPY --from=uv /uv /usr/local/bin/uv
COPY ${SERVICE}/pyproject.toml ${SERVICE}/uv.lock ./
RUN uv sync --locked --no-dev

FROM python:3.12.16-slim-bookworm AS runtime

ARG SERVICE
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app/shared \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=build /app/.venv/ ./.venv/
COPY ${SERVICE}/app/ ./app/
COPY shared/ ./shared/

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).close()"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers", "--no-access-log"]

FROM python:3.12.16-slim-trixie AS converter
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app/shared \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp
COPY --from=build /app/.venv/ ./.venv/
COPY ingestion-service/app/converter.py ./app/converter.py
COPY shared/rag_http.py shared/rag_telemetry.py ./shared/

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).close()"]
CMD ["uvicorn", "app.converter:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers", "--no-access-log"]

FROM runtime AS app

FROM runtime AS parser
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN docling-tools models download layout tableformer --output-dir /opt/docling
ENV DOCLING_ARTIFACTS_PATH=/opt/docling \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    OMP_NUM_THREADS=2 \
    HOME=/tmp
USER 10001:10001
