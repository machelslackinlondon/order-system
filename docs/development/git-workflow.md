# Git and TDD workflow

## Repository

- Location: <https://github.com/machelslackinlondon/distributed-order-system>
- Default branch: `main`
- Delivery style: small focused commits pushed after validation

## Branch strategy

Phase 0 initializes `main`. Subsequent feature work should use short-lived topic branches when useful, keep commits focused, and merge without squashing the educational red/green history.

## Conventional commits

- `test(<topic>): ...` records a failing behavioral expectation.
- `feat(<topic>): ...` implements that expectation.
- `fix(<topic>): ...` corrects existing behavior.
- `refactor(<topic>): ...` improves structure without changing behavior.
- `docs(<topic>): ...` updates learning material.
- `chore(<topic>): ...` changes tooling or infrastructure without business behavior.

## Behavioral TDD cycle

1. Add a focused test that expresses one missing behavior.
2. Run only that test and verify it fails for the expected reason.
3. Commit the red state with `test(<topic>): ...`.
4. Implement the smallest production change that satisfies the test.
5. Run the focused test, then the relevant suite.
6. Refactor only while tests remain green.
7. Commit the green state with `feat(<topic>): ...`.
8. Update documentation and `commit-map.md` with both commit hashes.
9. Run tests, lint, formatting, and build checks before pushing.

An intentional red commit is a teaching artifact. Its failure and the following green commit must be identified in the commit map; unrelated failures are never committed.

## Inspecting history

```bash
git log --oneline --decorate --graph
git log --oneline --grep='concurrency'
git log --oneline --grep='idempotency'
git show "$(git log -1 --format=%H --grep='test(concurrency)')"
topic_red_commit=$(git log -1 --format=%H --grep='test(concurrency)')
topic_green_commit=$(git log -1 --format=%H --grep='feat(concurrency)')
git diff "$topic_red_commit..$topic_green_commit"
```

Use the commit map to locate each concept, its test, implementation, documentation, and relevant files.
