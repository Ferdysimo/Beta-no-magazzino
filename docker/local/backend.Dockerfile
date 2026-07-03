# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app/backend

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip \
    && grep -vE '^emergentintegrations==' /tmp/requirements.txt > /tmp/requirements-backend.txt \
    && for attempt in 1 2 3 4 5; do \
        pip install --retries 10 --timeout 60 --progress-bar off -r /tmp/requirements-backend.txt && break; \
        if [ "$attempt" = "5" ]; then exit 1; fi; \
        echo "pip install failed, retrying attempt $((attempt + 1))/5"; \
        sleep 5; \
    done

COPY backend /app/backend

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
