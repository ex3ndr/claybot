import type { MessageContext } from "@/types";
import type { SessionDescriptor } from "./descriptor.js";

export function sessionContextIsHeartbeat(
  context: MessageContext,
  session?: SessionDescriptor
): boolean {
  return !!context.heartbeat || session?.type === "heartbeat";
}
