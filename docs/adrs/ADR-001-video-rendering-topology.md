# ADR-001: Video Rendering Topology

Status: Accepted

## Context

We require a deterministic, composable video rendering pipeline that separates cut assembly from visual transitions for clarity, optionality, and performance isolation.

### Decision

Adopt two services in sequence:

- `video-cuts` → produces `renders/base_cuts.mp4`
- `video-transitions` (optional) → produces `renders/with_transitions.mp4`

Branding consumes the transitions output if present, otherwise the cuts output.

### Consequences

- Clear contracts and artefact boundaries between cuts and transitions.
- Optional transitions via orchestration Choice state.
- Enables independent scaling, timeouts, and retries per service.
- Simplifies UAT and golden comparisons by standardizing artefacts.

### Migration

- Rename any references to POC final naming to the canonical outputs.
- Ensure branding input logic supports both `with_transitions` and `base_cuts`.
