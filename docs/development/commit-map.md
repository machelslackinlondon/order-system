# Commit map

This map connects interview topics to their red tests, green implementations, documentation, and main files. Exact hashes are added for behavioral topics after both commits exist.

| Topic                 | Test commit    | Implementation/final commit                                                                                              | Main files                           | Concepts                                       |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| Repository foundation | Not behavioral | `chore(repo): initialise JavaScript monorepo`                                                                            | `package.json`, `apps/`, `packages/` | npm workspaces, ESM, Jest, quality gates       |
| Local infrastructure  | Not behavioral | `chore(infrastructure): add local PostgreSQL and Redis services`; `fix(infrastructure): bind local services to loopback` | `docker-compose.yml`, `.env.example` | local dependencies, health checks, persistence |
| Development workflow  | Not behavioral | `docs(development): document TDD and commit workflow`                                                                    | `README.md`, `docs/development/`     | red/green history, Conventional Commits        |

Find a listed commit by subject:

```bash
git log --oneline --fixed-strings --grep='chore(repo): initialise JavaScript monorepo'
```

Later rows will record the exact red and green hashes because those pairs are the core interview evidence.
