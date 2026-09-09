# Local workload access control

`packages/access-control` provides an executable least-privilege policy example for local
workloads. Access checks use an exact workload, resource, and action tuple and deny anything that
is not listed.

| Workload             | Granted access                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `api`                | Read products; read/write orders; publish `order-created` messages                                       |
| `worker`             | Consume `order-created`; read/write products and orders; write message claims; publish `order-completed` |
| `analytics-consumer` | Consume `order-created`; write order analytics                                                           |

Policy construction rejects wildcard resources, wildcard actions, and unsupported actions such as
administrative access. Malformed policy definitions produce the stable
`INVALID_LOCAL_ACCESS_POLICY` error. Unknown or malformed access requests are denied without
coercing their fields.

## Boundary

This module records and tests intended capabilities; it is not wired into the application runtime.
It does not replace separate process accounts, container restrictions, database grants, or
filesystem permissions. If it is integrated later, each operation should be checked immediately
before accessing its dependency, and each workload should receive separate dependency credentials.

## Focused verification

```bash
npm run test:unit -- packages/access-control/tests/unit
```
