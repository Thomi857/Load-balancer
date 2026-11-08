# Load-Balanced Backend

A production-minded educational backend built incrementally with TypeScript, Fastify, and PostgreSQL. This phase adds PostgreSQL-backed item CRUD. Redis, HAProxy, and multiple API instances are not included.

## Requirements and local setup

- Node.js 22+
- npm
- Docker Compose

```sh
npm ci
cp .env.example .env
```

Replace the placeholder database passwords in `.env` with local-only values. The same variables configure the app and the Compose PostgreSQL services; credentials are not committed in Compose or application source.

Start the development database, apply migrations, then start the API:

```sh
docker compose up -d postgres
npm run migrate
npm run dev
```

The API listens on `http://localhost:3000`. To run the production image, build with `docker build -t load-balanced-backend .` and pass the required `DB_*` settings to the container environment.

## Configuration

Application settings are loaded from `.env` by the Node.js entry points. Database settings are required:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP bind address |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | Fastify/Pino log level |
| `INSTANCE_ID` | Generated UUID | Optional per-process instance identity |
| `DB_HOST` | — | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | — | Database name |
| `DB_USER` | — | Database user |
| `DB_PASSWORD` | — | Database password |
| `DB_POOL_MAX` | `10` | Maximum connections in the process pool |
| `DB_CONNECTION_TIMEOUT_MS` | `5000` | Maximum wait to establish a connection |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Time before an idle pool connection is closed |
| `DB_QUERY_TIMEOUT_MS` | `10000` | Query and statement timeout |

Invalid ports, pool limits, or log levels fail configuration at startup. Database connection failures do not expose credentials or SQL details in responses or logs.

## Database architecture and migrations

`src/db/pool.ts` creates the PostgreSQL connection pool from validated configuration. `src/db/plugin.ts` decorates Fastify with the pool and closes it from Fastify's `onClose` hook, including graceful SIGINT/SIGTERM shutdown. `GET /health` checks process liveness only; `GET /ready` runs `SELECT 1` and returns `503 {"status":"unavailable"}` when PostgreSQL cannot be reached.

Item requests flow from JSON-schema validated routes in `src/routes/items.ts` to `ItemService` and then `ItemRepository`. SQL is parameterized and remains in the repository. The initial migration creates the constrained `items` table, UUID primary key, timestamps, updated-time trigger, and creation-order index.

Migrations are SQL files tracked by name and SHA-256 checksum in `schema_migrations`. The runner takes a PostgreSQL advisory lock and applies each migration and its ledger entry in one transaction. Re-running `npm run migrate` is safe; an edited, already-applied migration is rejected instead of silently diverging.

## API

- `GET /health` — `200 {"status":"ok"}`; process liveness.
- `GET /ready` — `200 {"status":"ready"}` when PostgreSQL responds, otherwise `503 {"status":"unavailable"}`.
- `GET /api/instance` — process instance ID, hostname, and ISO timestamp.
- `POST /api/items` — create an item; returns `201` and the item.
- `GET /api/items` — returns an array of items ordered by creation time.
- `GET /api/items/:id` — returns an item, or `404` when missing.
- `PUT /api/items/:id` — replaces item name and description; omitted description becomes empty; returns `404` when missing.
- `DELETE /api/items/:id` — deletes an item; returns `204`, or `404` when missing.

Item bodies accept a required `name` (1–200 characters) and optional `description` (up to 10,000 characters). Unknown properties, invalid UUIDs, and invalid bodies receive `400`. Server/database errors return generic 5xx responses.

Item response shape:

```json
{
  "id": "uuid",
  "name": "Desk lamp",
  "description": "Adjustable",
  "createdAt": "2026-11-08T11:00:00.000Z",
  "updatedAt": "2026-11-08T11:00:00.000Z"
}
```

## Tests and checks

Unit tests do not require PostgreSQL:

```sh
npm run test:unit
```

Integration tests use only the isolated `backend_test` database. The test service uses a separate PostgreSQL container with ephemeral storage and a host port of `5433`; test configuration is read from `TEST_DB_*` and is never taken from the app's `DB_*` settings.

```sh
docker compose --profile test up -d postgres-test
npm test
npm run test:integration
docker compose --profile test down
```

The integration suite runs migrations twice to verify idempotence; exercises PostgreSQL-backed CRUD, validation, missing-item behavior, unavailable-database readiness, pool cleanup, and the compiled server's real HTTP/SIGTERM lifecycle. `TEST_DB_NAME` must be exactly `backend_test`; tests refuse another database name.

Other checks:

```sh
npm run lint
npm run build
```

To run one unit test file:

```sh
npx tsx --test test/items.unit.test.ts
```
# Load-balancer
