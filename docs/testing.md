# Testing

Tests live alongside sources and use `*.spec.ts`.

Current coverage:
- `cron.spec.ts` verifies cron scheduler dispatch and cron parsing.
- `cron-store.spec.ts` verifies cron task storage and memory files.
- `agents/ops/agentInbox.spec.ts` verifies inbox sequencing.
- `agents/agent.spec.ts` verifies agent persistence on create.
- `agents/ops/agentHistoryLoad.spec.ts` verifies history reset handling.

```mermaid
flowchart TD
  Tests --> CronSpec[cron.spec.ts]
  Tests --> CronStoreSpec[cron-store.spec.ts]
  Tests --> InboxSpec[ops/agentInbox.spec.ts]
  Tests --> AgentSpec[agent.spec.ts]
  Tests --> HistorySpec[agentHistoryLoad.spec.ts]
```
