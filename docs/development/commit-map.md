# Commit map

This map connects interview topics to their red tests, green implementations, documentation, and main files.

| Topic                  | Test commit                                | Implementation/final commit                                                                                              | Main files                                                | Concepts                                            |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------- |
| Repository foundation  | Not behavioral                             | `chore(repo): initialise JavaScript monorepo`                                                                            | `package.json`, `apps/`, `packages/`                      | npm workspaces, ESM, Jest, quality gates            |
| Local infrastructure   | Not behavioral                             | `chore(infrastructure): add local PostgreSQL and Redis services`; `fix(infrastructure): bind local services to loopback` | `docker-compose.yml`, `.env.example`                      | local dependencies, health checks, persistence      |
| Development workflow   | Not behavioral                             | `docs(development): document TDD and commit workflow`                                                                    | `README.md`, `docs/development/`                          | red/green history, Conventional Commits             |
| PostgreSQL persistence | `351f1ae69097709d1bc17747c089b8451facdca9` | `062b7ca5db357653612580599f3c1867ee195e26`                                                                               | `packages/database/migrations/`, `packages/database/src/` | migrations, constraints, parameterized repositories |
| Pending order creation | `69f9204fba69cda59f67769b0d94843423151c20` | `8afb147bfb6272aafc8318800d4384d166e96859`                                                                               | `apps/api/src/create-order.js`                            | application service, advisory stock validation      |
| POST /orders           | `85d72cef62bf6bf4b1a9e5aee198a9b82f8b4286` | `0eb21178dfa75ecef4f7583937f186d5fca29d7c`                                                                               | `apps/api/src/app.js`, `apps/api/src/orders-route.js`     | Fastify schema, injection, stable errors            |

Find a listed commit by subject:

```bash
git log --oneline --fixed-strings --grep='chore(repo): initialise JavaScript monorepo'
```
