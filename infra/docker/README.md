# Local infrastructure

The root `docker-compose.yml` runs the stateful services needed by the educational system.

| Service       | Purpose                                      | Local endpoint   | Persistent volume |
| ------------- | -------------------------------------------- | ---------------- | ----------------- |
| PostgreSQL 17 | Source-of-truth orders and inventory         | `localhost:5432` | `postgres-data`   |
| Redis 7.4     | Later cache and distributed-lock experiments | `localhost:6379` | `redis-data`      |

Start and inspect the services with:

```bash
docker compose up -d
docker compose ps
```

Stop containers without deleting data with `docker compose down`. Delete named volumes only when intentionally resetting local state. The credentials in `.env.example` are development-only and must not be reused in deployed environments.

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
