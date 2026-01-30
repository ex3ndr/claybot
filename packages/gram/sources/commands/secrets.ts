import { intro, outro } from "@clack/prompts";

import { setSecret } from "../engine/client.js";

export async function setSecretCommand(
  instanceId: string,
  key: string,
  value: string
): Promise<void> {
  intro("gram secrets");
  await setSecret(instanceId, key, value);
  outro(`Stored ${key} for ${instanceId}.`);
}
