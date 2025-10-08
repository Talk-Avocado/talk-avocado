# ADR-005: Phase-1 Security Baseline

Status: Accepted

## Context

We need consistent authN/Z, encryption, rate limiting, and audit logging across services in Phase-1.

### Decision

- Auth: tenant-scoped JWT/HMAC for job API; TLS everywhere.
- Encryption: KMS/SSE for S3 and DynamoDB.
- Per-tenant rate limits; audit logging of sensitive operations.

### Consequences

- Reduced risk of cross-tenant data leaks.
- Aligned security posture across services and environments.
