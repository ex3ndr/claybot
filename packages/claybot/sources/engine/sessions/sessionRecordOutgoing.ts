import { createId } from "@paralleldrive/cuid2";
import type { Logger } from "pino";

import type { MessageContext } from "../connectors/types.js";
import type { FileReference } from "../../files/types.js";
import type { Session } from "./session.js";
import type { SessionState } from "./sessionStateTypes.js";
import type { SessionStore } from "./store.js";

/**
 * Records an outgoing session entry to the session store.
 * Expects: session belongs to the store, and context matches the outgoing target.
 */
export async function sessionRecordOutgoing(params: {
  sessionStore: SessionStore<SessionState>;
  session: Session<SessionState>;
  source: string;
  context: MessageContext;
  text: string | null;
  files?: FileReference[];
  origin?: "model" | "system";
  logger: Logger;
}): Promise<void> {
  const messageId = createId();
  try {
    await params.sessionStore.recordOutgoing(
      params.session,
      messageId,
      params.source,
      params.context,
      params.text,
      params.files,
      params.origin
    );
  } catch (error) {
    params.logger.warn(
      { sessionId: params.session.id, source: params.source, messageId, error },
      "Session persistence failed"
    );
  }
}
