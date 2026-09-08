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
