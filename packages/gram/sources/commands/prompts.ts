import { prompt } from "enquirer";

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

function isPromptCancelled(error: unknown): boolean {
  return error instanceof Error && CANCEL_ERROR_NAMES.has(error.name);
}

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
