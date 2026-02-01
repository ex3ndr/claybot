import type { Context } from "@mariozechner/pi-ai";

import { normalizePermissions } from "../permissions.js";
import type { SessionPermissions } from "@/types";
import { permissionEnsureDefaultFile } from "../permissions/permissionEnsureDefaultFile.js";
import { normalizeSessionDescriptor } from "./descriptor.js";
import { sessionAgentNormalize } from "./sessionAgentNormalize.js";
import { sessionRoutingNormalize } from "./sessionRoutingNormalize.js";
import type { SessionState } from "./sessionStateTypes.js";

export function sessionStateNormalize(
  state: unknown,
  defaultPermissions: SessionPermissions
): SessionState {
  const fallback: SessionState = {
    context: { messages: [] },
    providerId: undefined,
    permissions: { ...defaultPermissions },
    session: undefined
  };
  if (state && typeof state === "object") {
    const candidate = state as {
      context?: Context;
      providerId?: string;
      permissions?: unknown;
      session?: unknown;
      routing?: unknown;
      agent?: unknown;
    };
    const permissions = normalizePermissions(
      candidate.permissions,
      defaultPermissions.workingDir
    );
    permissionEnsureDefaultFile(permissions, defaultPermissions);
    const session = normalizeSessionDescriptor(candidate.session);
    const routing = sessionRoutingNormalize(candidate.routing);
    const agent = sessionAgentNormalize(candidate.agent);
    if (candidate.context && Array.isArray(candidate.context.messages)) {
      return {
        context: candidate.context,
        providerId: typeof candidate.providerId === "string" ? candidate.providerId : undefined,
        permissions,
        session,
        routing,
        agent
      };
    }
    return { ...fallback, permissions, session, routing, agent };
  }
  return fallback;
}
