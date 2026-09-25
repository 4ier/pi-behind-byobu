/**
 * Thin, injectable wrapper around the tmux CLI.
 *
 * `run` is injectable so the test suite can assert the exact command sequence
 * without a live server, and `socket` maps to `tmux -L <name>` so both the
 * integration tests and Byobu users with a custom socketdir stay reachable.
 */

import { execFile } from "node:child_process";

import { ToolError } from "./errors.js";

const FIELD_SEP = "\u001f";
const PANE_FORMAT = [
  "#{pane_id}",
  "#{pane_title}",
  "#{pane_active}",
  "#{pane_in_mode}",
  "#{window_id}",
  "#{window_name}",
].join(FIELD_SEP);

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
     * @returns {Promise<Array<{paneId: string, title: string, active: string, inMode: string, windowId: string, windowName: string}>>}
     * @throws {ToolError} when tmux cannot list panes; callers must not mistake that for "nothing to do"
     */
    async listPanes() {
      const result = await invoke(["list-panes", "-a", "-F", PANE_FORMAT]);
      assertOk(result, "list-panes -a");
      return result.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split(FIELD_SEP))
        .filter((fields) => fields.length === 6)
        .map(([paneId, title, active, inMode, windowId, windowName]) => ({
          paneId,
          title,
          active,
          inMode,
          windowId,
          windowName,
        }));
    },
  };
}
