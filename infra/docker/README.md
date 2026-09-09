# Local infrastructure

The root `docker-compose.yml` runs stateful dependencies by default and the application stack
through the optional `app` profile using only local containers and host dependencies.

| Service       | Purpose                                      | Local endpoint      | Persistent volume |
| ------------- | -------------------------------------------- | ------------------- | ----------------- |
| Caddy 2       | Loopback-only application gateway            | `localhost:8080`    | None              |
| Node.js API   | Order HTTP boundary and process-local queue  | Internal `api:3000` | None              |
| Migrator      | Applies PostgreSQL migrations before the API | One-shot container  | None              |
| PostgreSQL 17 | Source-of-truth orders and inventory         | `localhost:5432`    | `postgres-data`   |
| Redis 7.4     | Cache and distributed-lock experiments       | `localhost:6379`    | `redis-data`      |

Start and inspect only PostgreSQL and Redis with:

```bash
docker compose up -d
docker compose ps
```

Run the containerized API and gateway with:

```bash
docker compose --profile app up --build -d
curl --fail http://127.0.0.1:8080/health
docker compose --profile app ps
```

The migrator must finish and the API must become healthy before Caddy accepts traffic. Only Caddy
is exposed as an application endpoint. Set `GATEWAY_PORT` to change its loopback port.

This profile has no service subscription cost. It still consumes the host's compute, storage,
network, and electricity. Image downloads require registry access.

The queue is memory inside the API process. A separate worker container could not consume it, so
this profile deliberately defines none. The API still has no active queue consumer, and queued
messages do not survive restart; use this topology for local development, not durable distributed
processing.

Stop containers without deleting data with `docker compose --profile app down`. Delete named
volumes only when intentionally resetting local state. The credentials in `.env.example` are
development-only and must not be reused outside local development.

## Test database

A fresh PostgreSQL volume runs `infra/docker/postgres/init/001-create-test-database.sql` and creates `orders_test` automatically.

Volumes created before Phase 1 do not rerun initialization scripts. Check an existing volume with:

```bash
docker compose exec -T postgres psql -U orders -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'orders_test'"
```

If that command prints nothing, create only the missing database:

```bash
docker compose exec -T postgres psql -U orders -d postgres \
  -c "CREATE DATABASE orders_test"
```

Do not delete the named PostgreSQL volume to recover a missing test database.
