# Sentinel backend on Hugging Face Spaces (Docker SDK). Build context = this Space's repository,
# assembled by local-e2e\hf_space.cmd from backend/app, sentinel/scripts and docs/contracts.
# Secrets are NOT here: set SENTINEL_HMAC_SECRET and GITLAB_WEBHOOK_SECRET under Space settings → Secrets.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860 \
    SENTINEL_ENV=production \
    SENTINEL_EVENT_SCHEMA_PATH=/workspace/contracts/event.schema.json \
    SENTINEL_SQLITE_PATH=/tmp/sentinel.db \
    SENTINEL_STATE_CACHE_DIR=/tmp/sentinel-state \
    CORS_ORIGINS=https://showcase-46f803.gitlab.io \
    GITLAB_PROJECT_ID=87291088 \
    PYTHONPATH=/workspace

WORKDIR /workspace

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY sentinel/ ./sentinel/
COPY contracts/ ./contracts/

RUN useradd --create-home --uid 1000 sentinel
USER sentinel

EXPOSE 7860
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
