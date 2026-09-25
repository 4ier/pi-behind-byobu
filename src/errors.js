/**
 * Error types that map onto process exit codes.
 *
 * UsageError  -> exit 2: the user asked for something that cannot be done as written.
 * ToolError   -> exit 1: the environment got in the way (malformed config, tmux failure).
 */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

export class ToolError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "ToolError";
    this.exitCode = 1;
  }
}
