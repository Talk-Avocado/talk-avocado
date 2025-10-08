# ADR-002: Orchestration (Phase-1)

Status: Accepted

## Context

We need reliable orchestration with simple event inputs and built-in retries and failure handling.

### Decision

Use AWS Step Functions (Standard) for Phase-1. Harness payloads exactly match ASL Task inputs. Use per-task `Retry` for transient errors and `Catch` to route to a `mark-failed` step that updates the manifest.

### Event Shapes

See `docs/CONVENTIONS.md` for canonical Task input payloads for cuts, transitions, branding, and subtitles.

### Retry Policy

Retry only for `TRANSIENT_DEPENDENCY` and `TIMEOUT` with bounded attempts and exponential backoff with jitter.

### Consequences

- Deterministic, debuggable executions with execution history.
- Easy to add a Choice for optional transitions.
- Clear failure path to `mark-failed` to write manifest status and logs.
