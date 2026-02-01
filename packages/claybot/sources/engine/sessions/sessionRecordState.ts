import type { Logger } from "pino";

import type { Session } from "./session.js";
import type { SessionState } from "./sessionStateTypes.js";
import type { SessionStore } from "./store.js";

/**
 * Persists the current session state to the session store.
 * Expects: session belongs to the store and updatedAt is current.
 */
export async function sessionRecordState(params: {
  sessionStore: SessionStore<SessionState>;
  session: Session<SessionState>;
  source: string;
  logger: Logger;
}): Promise<void> {
  try {
    await params.sessionStore.recordState(params.session);
  } catch (error) {
    params.logger.warn(
      { sessionId: params.session.id, source: params.source, error },
      "Session persistence failed"
    );
  }
}
