import { setAuth } from "../engine/ipc/client.js";

export async function setAuthCommand(
  id: string,
  key: string,
  value: string
): Promise<void> {
  intro("gram auth");
  await setAuth(id, key, value);
  outro(`Stored ${key} for ${id}.`);
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
