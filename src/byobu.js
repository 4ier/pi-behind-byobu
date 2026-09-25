/**
 * Locating the file Byobu actually reads.
 *
 * This mirrors Byobu's own logic in `lib/byobu/include/dirs`, which is the
 * single most common source of confusion here: Byobu never reads
 * `~/.tmux.conf`, and its config directory is `$XDG_CONFIG_HOME/byobu` unless
 * a legacy `~/.byobu` exists (or `BYOBU_CONFIG_DIR` is set).
 */

import fs from "node:fs";
import path from "node:path";

import { ToolError } from "./errors.js";

export const TMUX_CONFIG_FILENAME = ".tmux.conf";

/**
 * @param {{env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean}} [deps]
 * @returns {{dir: string, source: string}}
 */
export function resolveByobuConfigDir({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.BYOBU_CONFIG_DIR) {
    return { dir: env.BYOBU_CONFIG_DIR, source: "BYOBU_CONFIG_DIR" };
  }

  const home = env.HOME;
  if (!home) {
    throw new ToolError("$HOME is not set; pass --config <path> to name the tmux config file");
  }

  const legacy = path.join(home, ".byobu");
  if (exists(legacy)) return { dir: legacy, source: "~/.byobu" };

  if (env.XDG_CONFIG_HOME) {
    return { dir: path.join(env.XDG_CONFIG_HOME, "byobu"), source: "$XDG_CONFIG_HOME/byobu" };
  }
  return { dir: path.join(home, ".config", "byobu"), source: "~/.config/byobu" };
}

/**
 * Best-effort answer to "is Byobu installed here?". Used only for messaging:
 * a false negative must never block an install.
 *
 * @param {{env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean}} [deps]
 */
export function detectByobu({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.BYOBU_BACKEND === "tmux" || env.BYOBU_PREFIX) return true;
  const home = env.HOME;
  if (!home) return false;
  if (exists(path.join(home, ".byobu"))) return true;
  const xdgBase = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return exists(path.join(xdgBase, "byobu"));
}

/**
 * Resolve the config file to edit: an explicit `--config` wins, otherwise the
 * Byobu config directory. A directory (or a path without a file name) gets
 * `.tmux.conf` appended.
 *
 * @param {string | undefined} explicit
 * @param {{env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean, statSync?: (p: string) => fs.Stats}} [deps]
 * @returns {{configPath: string, dir: string, source: string}}
 */
export function resolveConfigPath(explicit, deps = {}) {
  const { env = process.env, exists = fs.existsSync, statSync = fs.statSync } = deps;

  if (explicit) {
    const resolved = path.resolve(explicit);
    if ((exists(resolved) && statSync(resolved).isDirectory()) || resolved.endsWith(path.sep)) {
      const dir = resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
      return { configPath: path.join(dir, TMUX_CONFIG_FILENAME), dir, source: "--config" };
    }
    return { configPath: resolved, dir: path.dirname(resolved), source: "--config" };
  }

  const { dir, source } = resolveByobuConfigDir({ env, exists });
  return { configPath: path.join(dir, TMUX_CONFIG_FILENAME), dir, source };
}
