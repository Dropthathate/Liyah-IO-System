# Liyah-IO Funnel Backend

Go backend for tracking therapist funnel conversions.

## Quick Start

```bash
# Navigate to backend
cd backend

# Copy environment
cp .env.example .env

# Install dependencies
go mod download && go mod tidy

# Start with Docker
docker-compose up

# OR run locally
make dev
```

## API Endpoints

- `POST /api/hero/track` - Track hero view
- `GET /api/packages/` - Get packages
- `POST /api/packages/select` - Select package
- `GET /api/conversions/stats` - Get stats
- `GET /api/conversions/journey/:user_id` - Get journey
- `GET /health` - Health check

## Commands

```bash
make build    # Build
make run      # Run
make dev      # Development
make test     # Tests
make clean    # Clean up
```

## Architecture

5-stage funnel with database tracking of all conversions.
