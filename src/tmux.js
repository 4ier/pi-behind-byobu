/**
 * Thin, injectable wrapper around the tmux CLI.
 *
 * `run` is injectable so the test suite can assert the exact command sequence
 * without a live server, and `socket` maps to `tmux -L <name>` so both the
 * integration tests and Byobu users with a custom socketdir stay reachable.
 */

import { execFile } from "node:child_process";

import { ToolError } from "./errors.js";

/** Printable on purpose; see splitRecord(). */
export const PANE_SEPARATOR = "|";

const PANE_FORMAT = [
  "#{pane_id}",
  "#{pane_active}",
  "#{pane_in_mode}",
  "#{window_id}",
  "#{pane_title}",
].join(PANE_SEPARATOR);
const WINDOW_FORMAT = ["#{window_id}", "#{window_name}"].join(PANE_SEPARATOR);

/**
 * Split a `-F` line into its structured prefix and its free-text tail.
 *
 * tmux does not agree with itself about output: on tmux 3.4 (Ubuntu 24.04) a
 * control character in the format comes back escaped as the literal text
 * "\037", which silently collapsed every record into one unparsable field.
 * Printable separators survive everywhere, so the separator is "|" and the one
 * free-text field of each listing is placed last, where a stray separator is
 * rejoined instead of shifting the layout.
 *
 * @param {string} line
 * @param {number} parts number of leading structured fields
 * @returns {string[] | null} structured fields plus the rejoined tail, or null
 */
function splitRecord(line, parts) {
  const fields = line.split(PANE_SEPARATOR);
  if (fields.length < parts + 1) return null;
  return [...fields.slice(0, parts), fields.slice(parts).join(PANE_SEPARATOR)];
}

/**
 * @param {string} stdout output of `list-panes -a -F <PANE_FORMAT>`
 * @returns {Array<{paneId: string, active: string, inMode: string, windowId: string, title: string}>}
 */
export function parsePaneListing(stdout) {
  const panes = [];
  let skipped = 0;

  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const fields = splitRecord(line, 4);
    if (fields === null) {
      skipped += 1;
      continue;
    }
    const [paneId, active, inMode, windowId, title] = fields;
    panes.push({ paneId, active, inMode, windowId, title });
  }

  assertParsed(panes.length, skipped, "list-panes");
  return panes;
}

/**
 * @param {string} stdout output of `list-windows -a -F <WINDOW_FORMAT>`
 * @returns {Map<string, string>} window id to window name
 */
export function parseWindowNames(stdout) {
  const names = new Map();
  let skipped = 0;

  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const fields = splitRecord(line, 1);
    if (fields === null) {
      skipped += 1;
      continue;
    }
    const [windowId, name] = fields;
    names.set(windowId, name);
  }

  assertParsed(names.size, skipped, "list-windows");
  return names;
}

/**
 * tmux produced output we could not read: fail loudly instead of reporting
 * "nothing to do" for a server we simply failed to understand.
 */
function assertParsed(parsed, skipped, command) {
  if (parsed === 0 && skipped > 0) {
    throw new ToolError(
      `could not parse the output of tmux ${command} (${skipped} line(s)); ` +
        "re-run with --debug and report this with your tmux version",
    );
  }
}

/**
 * @param {string} raw e.g. "tmux 3.6b"
 * @returns {{major: number, minor: number, suffix: string, raw: string} | null}
 */
export function parseTmuxVersion(raw) {
  const match = /(\d+)\.(\d+)([a-z]?)/.exec(String(raw));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    suffix: match[3] ?? "",
    raw: String(raw).trim(),
  };
}

/** @returns {boolean} true when `version` is at least major.minor */
export function versionAtLeast(version, major, minor) {
  if (!version) return false;
  if (version.major !== major) return version.major > major;
  return version.minor >= minor;
}

/**
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv, timeoutMs?: number}} [options]
 * @returns {Promise<{code: number | null, stdout: string, stderr: string, missing: boolean}>}
 */
export function execTmux(args, { env = process.env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      "tmux",
      args,
      { env, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          resolve({ code: null, stdout: "", stderr: "tmux: command not found", missing: true });
          return;
        }
        resolve({
          code: error ? Number(error.code) || 1 : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          missing: false,
        });
      },
    );
  });
}

function assertOk(result, description) {
  if (result.missing) throw new ToolError(`tmux is not installed (while running: ${description})`);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new ToolError(`tmux ${description} failed: ${detail || `exit code ${result.code}`}`);
  }
}

/**
 * @param {{socket?: string | null, env?: NodeJS.ProcessEnv, run?: typeof execTmux, debug?: ((entry: {args: string[], result: object}) => void) | null}} [deps]
 */
export function createTmux({ socket = null, env = process.env, run = execTmux, debug = null } = {}) {
  const prefix = socket ? ["-L", socket] : [];
  const invoke = async (args, options) => {
    const argv = [...prefix, ...args];
    const result = await run(argv, { env, ...options });
    if (debug) debug({ args: argv, result });
    return result;
  };

  return {
    socket,
    invoke,

    /** @returns {Promise<{major: number, minor: number, suffix: string, raw: string} | null>} */
    async version() {
      const result = await invoke(["-V"]);
      if (result.missing || result.code !== 0) return null;
      return parseTmuxVersion(result.stdout);
    },

    async isServerRunning() {
      const result = await invoke(["list-sessions"]);
      return !result.missing && result.code === 0;
    },

    /** @returns {Promise<string | null>} */
    async getOption(name, { window = false } = {}) {
      const args = ["show-options", "-gqv"];
      if (window) args.push("-w");
      args.push(name);
      const result = await invoke(args);
      return result.code === 0 ? result.stdout.trim() : null;
    },

    async setGlobalOption(name, value) {
      assertOk(
        await invoke(["set-option", "-g", name, value]),
        `set-option -g ${name} ${JSON.stringify(value)}`,
      );
    },

    async setWindowOption(target, name, value) {
      assertOk(
        await invoke(["set-option", "-w", "-t", target, name, value]),
        `set-option -w -t ${target} ${name} ${JSON.stringify(value)}`,
      );
    },

    /**
     * tmux resolves a pane id to its window. Renaming also disables
     * `automatic-rename` for that window (tmux treats a manual name as an
     * opt-out), which is why callers re-enable it right after.
     */
    async renameWindow(target, name) {
      assertOk(await invoke(["rename-window", "-t", target, name]), `rename-window -t ${target}`);
    },

    /**
     * @returns {Promise<Array<{paneId: string, title: string, active: string, inMode: string, windowId: string, windowName: string | null}>>
     * @throws {ToolError} when tmux cannot list panes, or its output cannot be read
     */
    async listPanes() {
      const paneResult = await invoke(["list-panes", "-a", "-F", PANE_FORMAT]);
      assertOk(paneResult, "list-panes -a");
      const windowResult = await invoke(["list-windows", "-a", "-F", WINDOW_FORMAT]);
      assertOk(windowResult, "list-windows -a");

      const names = parseWindowNames(windowResult.stdout);
      return parsePaneListing(paneResult.stdout).map((pane) => ({
        ...pane,
        windowName: names.get(pane.windowId) ?? null,
      }));
    },
  };
}
