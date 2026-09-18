# Domain Risk Lenses

Use only the matching lens. These are missing-behavior prompts, not architecture prescriptions.

## Payment / money

Check: charge timing; authorization vs capture; duplicate request/idempotency; timeout with unknown external result; cancellation/refund boundary; amount/currency ownership; reconciliation and operator recovery. Do not infer Redis, Kafka, Outbox, or locks.

## Inventory / concurrency

Check: stock meaning; reservation boundary; non-negative invariant; competing requests; atomic success/failure; release/expiry; retry semantics; evidence under the actual datastore/runtime.

## Authentication / authorization

Check: identity source; protected action; permission owner; token/session expiry and revocation; replay; auditability; failure information disclosure.

## External integration

Check: source of truth; timeout; retry/backoff; duplicate side effects; callback ordering; partial success; reconciliation; manual recovery.

## Data migration / deletion

Check: compatibility window; backfill owner; rollback; partial progress; irreversible loss; verification before cleanup; observability and stop conditions.

## Sensitive data

Check: collection purpose; minimization; access boundary; storage/transit; retention/deletion; logs; incident and audit needs.

Ask only a lens item that changes this Story's behavior. Keep the rest out of scope.
