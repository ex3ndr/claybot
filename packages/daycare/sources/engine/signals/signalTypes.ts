export const SIGNAL_SOURCES = ["webhook", "agent", "process"] as const;

export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export type SignalGenerateInput = {
  type: string;
  source?: SignalSource;
  data?: unknown;
  agentId?: string;
};

export type Signal = {
  id: string;
  type: string;
  source: SignalSource;
  data?: unknown;
  agentId?: string;
  createdAt: number;
};
