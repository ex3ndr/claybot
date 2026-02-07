export type SignalSource =
  | { type: "system" }
  | { type: "agent"; id: string }
  | { type: "webhook"; id?: string }
  | { type: "process"; id?: string };

export type SignalGenerateInput = {
  type: string;
  source?: SignalSource;
  data?: unknown;
};

export type Signal = {
  id: string;
  type: string;
  source: SignalSource;
  data?: unknown;
  createdAt: number;
};
