# Scrappify VPS worker

The public web app writes scrape jobs directly to PostgreSQL. This private
service continuously claims those jobs and runs Playwright; it does not expose
an internet-facing port.

## Deploy

Create `/opt/scrappify/.env` with:

```dotenv
DATABASE_URL=postgresql://...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
AI_PROVIDER=ollama
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen3:4b
ALLOWED_SOURCE_HOSTS=beymen.com,www.beymen.com,zaptila.com,www.zaptila.com
WORKER_ID=scrappify-vps-1
POLL_SECONDS=2
```

Then place `docker-compose.yml` in the same directory and run:

```bash
docker compose pull
docker compose up -d
docker compose exec ollama ollama pull qwen3:4b
docker compose logs -f --tail=100 worker
```

## Operations

```bash
# Status
docker compose ps

# Recent logs
docker compose logs --tail=200 worker

# Restart
docker compose restart worker

# Pull the latest verified backend image
docker compose pull
docker compose up -d
```
