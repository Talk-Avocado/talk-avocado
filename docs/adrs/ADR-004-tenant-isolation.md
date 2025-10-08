# ADR-004: Tenant Isolation

Status: Accepted

## Context

The system must prevent cross-tenant data access both in cloud and local modes.

### Decision

- S3 prefixes per tenant: `{env}/{tenantId}/{jobId}/…`
- IAM session tag `tenantId` on all calls; S3 bucket policy denies cross-tenant access.
- DDB PK/SK scoped by tenant (`PK = tenantId`, `SK = jobSort`).
- Local harness includes negative tests to assert cross-tenant access is blocked.

### Consequences

- Clear security boundaries; simplified access policies.
- Easier multi-tenant reasoning and auditability.
