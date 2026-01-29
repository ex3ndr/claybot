# Engine updates

Scout updates engine settings using a three-step strategy:

1. **Local server running**: send a mutation request over the local HTTP socket at
   `.scout/scout.sock`.
2. **Local server not running**: write directly to the local config files
   (for auth updates, `.scout/auth.json`).
3. **Remote server configured**: reserved for future use (protocol matches the
   local socket transport).
   Remote updates are currently not implemented.

## Local socket
The `start` command launches a Fastify server bound to a Unix socket.

Current mutation endpoints:
- `POST /v1/engine/auth/telegram`
- `DELETE /v1/engine/auth/telegram`
- `POST /v1/engine/auth/codex`
- `DELETE /v1/engine/auth/codex`
- `POST /v1/engine/auth/claude-code`
- `DELETE /v1/engine/auth/claude-code`
- `POST /v1/engine/connectors/load`
- `POST /v1/engine/connectors/unload`
