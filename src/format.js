/**
 * Builders for the tmux `automatic-rename-format` expression.
 *
 * Background: Pi publishes `<APP_TITLE> - <session> - <cwd>` as the terminal
 * title using OSC 0. Inside tmux that only sets the *pane* title, and Byobu
 * turns `automatic-rename on` with tmux's stock format, which names windows
 * after the running command - `node` for Pi. The expression built here keeps
 * tmux's stock behaviour for every other program and prefers the pane title
 * for Pi panes.
 *
 * Verified against tmux 3.6b (all modifiers used here exist since tmux 3.0):
 *   - `#{m:pattern,string}` is an fnmatch(3) test.
 *   - `#{=N:...}` truncates the result to N characters.
 *   - `#{s/^regex/repl/:...}` substitutes; regex support landed in tmux 3.0.
 *   - `automatic-rename-format` is re-evaluated every time a pane title
 *     changes, so Pi's `/rename` propagates with no extra tooling.
 */

import { UsageError } from "./errors.js";

/** tmux's default `automatic-rename-format` (Byobu inherits this). */
export const STOCK_AUTOMATIC_RENAME_FORMAT =
  "#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}";

/** The glyph Pi puts in the terminal title unless PI renamed via piConfigName. */
export const DEFAULT_TITLE_PREFIX = "π";

/** Default window name length budget; Byobu's window list is cramped. */
export const DEFAULT_MAX_LENGTH = 24;

/**
 * Pi's `π - ` prefix is stripped by default: the window list is narrow, and the
 * session name is the part that says what a window is. `--keep-prefix` brings it
 * back for setups that want Pi windows to be recognisable at a glance.
 */
export const DEFAULT_STRIP_PREFIX = true;

/**
 * Characters that would break out of the tmux format string, the `s/…/…/`
 * delimiter, the single-quoted config line, or fnmatch matching.
 */
const FORBIDDEN_PREFIX_CHARS = /[,:{}#/'[\]()*?\\]/;

/**
 * @param {{titlePrefix?: string, maxLength?: number, stripPrefix?: boolean}} [options]
 * @returns {{titlePrefix: string, maxLength: number, stripPrefix: boolean}}
 */
export function normalizeOptions(options = {}) {
  const titlePrefix = options.titlePrefix ?? DEFAULT_TITLE_PREFIX;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const stripPrefix = Boolean(options.stripPrefix ?? DEFAULT_STRIP_PREFIX);

  if (typeof titlePrefix !== "string" || titlePrefix.trim() === "") {
    throw new UsageError("--title-prefix must be a non-empty string");
  }
  if (FORBIDDEN_PREFIX_CHARS.test(titlePrefix)) {
    throw new UsageError(
      "--title-prefix must not contain any of , : { } # / ' [ ] ( ) * ? \\",
    );
  }
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new UsageError("--max-length must be an integer >= 0 (0 disables truncation)");
  }

  return { titlePrefix, maxLength, stripPrefix };
}

/** tmux escapes a literal `#` in a format by doubling it. */
function escapeFormatLiteral(literal) {
  return String(literal).replace(/#/g, "##");
}

function escapeRegExp(literal) {
  return String(literal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * fnmatch pattern matching Pi's titles, including titles that a Pi extension
 * prefixed with a spinner frame (`⠋ π - session - cwd`).
 */
export function titleMatchPattern(titlePrefix = DEFAULT_TITLE_PREFIX) {
  return `*${escapeFormatLiteral(titlePrefix)} -*`;
}

/**
 * @param {{titlePrefix?: string, maxLength?: number, stripPrefix?: boolean}} [options]
 * @returns {string} tmux format expression for `automatic-rename-format`
 */
export function buildAutomaticRenameFormat(options = {}) {
  const { titlePrefix, maxLength, stripPrefix } = normalizeOptions(options);

  const value = stripPrefix
    ? `#{s/^.*${escapeFormatLiteral(titlePrefix)} - //:pane_title}`
    : "#{pane_title}";
  const sized = maxLength > 0 ? `#{=${maxLength}:${value}}` : value;

  return `#{?#{m:${titleMatchPattern(titlePrefix)},#{pane_title}},${sized},${STOCK_AUTOMATIC_RENAME_FORMAT}}`;
}

/**
 * JavaScript mirror of the tmux expression, used when renaming windows that
 * are already running (tmux only re-evaluates `automatic-rename-format` when
 * a pane title changes, so existing windows have to be renamed explicitly).
 *
 * @param {string} paneTitle
 * @param {{titlePrefix?: string, maxLength?: number, stripPrefix?: boolean}} [options]
 * @returns {string | null} the window name to use, or null when the pane is not a Pi pane
 */
export function preferredWindowName(paneTitle, options = {}) {
  const { titlePrefix, maxLength, stripPrefix } = normalizeOptions(options);
  if (typeof paneTitle !== "string" || !paneTitle.includes(`${titlePrefix} -`)) return null;

  let name = paneTitle;
  if (stripPrefix) {
    // Greedy `^.*` mirrors tmux's `s/^.*<prefix> - //`: strip up to the last match.
    name = name.replace(new RegExp(`^.*${escapeRegExp(titlePrefix)} - `), "");
  }
  if (maxLength > 0) name = Array.from(name).slice(0, maxLength).join("");
  return name;
}
