# Agent Creation Permission Pre-Grants

`start_background_agent` and `create_permanent_agent` now accept an optional
`permissions` list (`@network`, `@read:<abs-path>`, `@write:<abs-path>`).
Creation validates that the creator already has every requested permission
before any grants are applied.

## Flow

```mermaid
sequenceDiagram
  participant Creator as Creator Agent
  participant Tool as Creation Tool
  participant Check as permissionTagsValidate
  participant AgentSystem
  participant Target as New Agent

  Creator->>Tool: create(..., permissions)
  Tool->>Check: validate creator owns tags
  Check-->>Tool: allowed
  Tool->>AgentSystem: resolve/create target agent
  Tool->>AgentSystem: grant validated permissions
  Tool->>AgentSystem: deliver initial message (subagent) or persist state (permanent)
  AgentSystem-->>Target: starts with pre-granted permissions
```

## Notes

- Validation runs against the creator's current permissions, matching `grant_permission` semantics.
- Subagent creation grants permissions before posting the first prompt.
- Permanent agent create/update applies validated tags directly into persisted `state.json`.
