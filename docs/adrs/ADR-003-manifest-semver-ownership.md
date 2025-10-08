# ADR-003: Manifest Semver and Ownership

Status: Accepted

## Context

Multiple services write to a shared job manifest. We need schema governance to enable safe evolution and validation.

### Decision

- Use semantic versioning for the manifest schema.
- Appoint a schema owner responsible for changes and reviews.
- Allow service-specific additions under `extra.<service>.*`.
- Validate schema on every manifest write.

### Consequences

- Predictable change management and compatibility guarantees.
- Clear extension mechanism for service-specific needs.
- Early detection of schema violations via validation in CI and at runtime.
