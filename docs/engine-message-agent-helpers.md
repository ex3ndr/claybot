# Engine Message and Agent Helper Extraction

Extracted message-formatting helpers and agent normalization utilities into dedicated modules for easier reuse and testing.

```mermaid
flowchart TD
  Engine[engine.ts] --> MsgBuild[messageBuildUser.ts]
  Engine --> MsgFormat[messageFormatIncoming.ts]
  Engine --> MsgExtractText[messageExtractText.ts]
  Engine --> MsgExtractTools[messageExtractToolCalls.ts]
  Engine --> MsgSystem[messageBuildSystemText.ts]
  Engine --> MsgIsSystem[messageIsSystemText.ts]
  Engine --> AgentBuild[agentDescriptorBuild.ts]
  Engine --> AgentKey[agentKeyBuild.ts]
  Engine --> AgentCron[agentDescriptorIsCron.ts]
  Engine --> AgentHeartbeat[agentDescriptorIsHeartbeat.ts]
  Engine --> AgentRouting[agentRoutingSanitize.ts]
  Engine --> AgentTimestamp[agentTimestampGet.ts]
```
