import type { MessageContext } from "@/types";
import type { SessionDescriptor } from "./descriptor.js";
import { cuid2Is } from "../../utils/cuid2Is.js";

export function sessionContextIsCron(
  context: MessageContext,
  session?: SessionDescriptor
): boolean {
  return cuid2Is(context.cron?.taskUid ?? null) || session?.type === "cron";
}
