import Enquirer from "enquirer";
// @ts-expect-error enquirer does not ship types for internal keypress module
import keypress from "enquirer/lib/keypress.js";

export type PromptChoice<TValue extends string> = {
  value: TValue;
  name: string;
  description?: string;
};

export type PromptInputConfig = {
  message: string;
  default?: string;
  placeholder?: string;
};

export type PromptConfirmConfig = {
  message: string;
  default?: boolean;
};

export type PromptSelectConfig<TValue extends string> = {
  message: string;
  choices: Array<PromptChoice<TValue>>;
};

type PromptResult<TValue> = {
  value: TValue;
};

const CANCEL_ERROR_NAMES = new Set(["CancelError", "ExitPromptError", "AbortError"]);
const CANCEL_ERROR_CODES = new Set(["ERR_USE_AFTER_CLOSE"]);

function isPromptCancelled(error: unknown): boolean {
  // enquirer rejects with an empty string when user cancels
  if (typeof error === "string") {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  return CANCEL_ERROR_NAMES.has(error.name) || (code ? CANCEL_ERROR_CODES.has(code) : false);
}

type KeypressModule = {
  listen: (...args: unknown[]) => () => void;
  __gramPatched?: boolean;
};

const keypressModule = keypress as unknown as KeypressModule;
if (!keypressModule.__gramPatched) {
  const originalListen = keypressModule.listen.bind(keypressModule);
  keypressModule.listen = (...args: unknown[]) => {
    const stop = originalListen(...args);
    let stopped = false;
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        stop();
      } catch (error) {
        if (!isPromptCancelled(error)) {
          throw error;
        }
      }
    };
  };
  keypressModule.__gramPatched = true;
}

const { prompt } = Enquirer;

async function runPrompt<TValue>(config: Record<string, unknown>): Promise<TValue | null> {
  try {
    const result = await prompt<PromptResult<TValue>>(config as never);
    if (!result || !Object.prototype.hasOwnProperty.call(result, "value")) {
      return null;
    }
    return result.value ?? null;
  } catch (error) {
    if (isPromptCancelled(error)) {
      return null;
    }
    throw error;
  }
}

function formatMessage(message: string, placeholder?: string): string {
  if (!placeholder) {
    return message;
  }
  return `${message} (${placeholder})`;
}

export async function promptInput(config: PromptInputConfig): Promise<string | null> {
  return runPrompt<string>({
    type: "input",
    name: "value",
    message: formatMessage(config.message, config.placeholder),
    initial: config.default
  });
}

export async function promptConfirm(
  config: PromptConfirmConfig
): Promise<boolean | null> {
  return runPrompt<boolean>({
    type: "confirm",
    name: "value",
    message: config.message,
    initial: config.default
  });
}

export async function promptSelect<TValue extends string>(
  config: PromptSelectConfig<TValue>
): Promise<TValue | null> {
  return runPrompt<TValue>({
    type: "select",
    name: "value",
    message: config.message,
    choices: config.choices.map((choice) => ({
      name: choice.value,
      message: choice.name,
      value: choice.value,
      hint: choice.description
    }))
  });
}
