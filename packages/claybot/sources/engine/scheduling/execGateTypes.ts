/**
 * Exec gate configuration for scheduled tasks.
 */
export type ExecGateDefinition = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  permissions?: string[];
  allowedDomains?: string[];
};
