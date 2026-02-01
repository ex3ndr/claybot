import type { MessageContext } from "@/types";

export function sessionRoutingSanitize(context: MessageContext): MessageContext {
  const { messageId, commands, ...rest } = context;
  return { ...rest };
}
