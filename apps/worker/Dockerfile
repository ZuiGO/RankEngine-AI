# Production build for Python Worker using official Playwright pre-built image
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

WORKDIR /app

# Install poetry for lockfile dependency resolution
RUN pip install --no-cache-dir poetry

# Configure poetry to link packages globally inside the container
RUN poetry config virtualenvs.create false

# Copy pyproject.toml
COPY apps/worker/pyproject.toml ./

# Generate lock file and install python dependencies
RUN poetry lock && poetry install --no-root --no-interaction --no-ansi

# Copy application files
COPY apps/worker/ ./

EXPOSE 8000

# Start Uvicorn to run health endpoints (lifespan initiates worker & monitors)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
