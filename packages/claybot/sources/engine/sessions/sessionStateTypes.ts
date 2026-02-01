import type { Context } from "@mariozechner/pi-ai";

import type { MessageContext } from "@/types";
import type { SessionPermissions } from "@/types";
import type { SessionDescriptor } from "./descriptor.js";

export type SessionState = {
  context: Context;
  providerId?: string;
  permissions: SessionPermissions;
  session?: SessionDescriptor;
  routing?: {
    source: string;
    context: MessageContext;
  };
  agent?: {
    kind: "background";
    parentSessionId?: string;
    name?: string;
  };
};
