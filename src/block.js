/**
 * The managed block we own inside Byobu's tmux config file.
 *
 * Everything between the markers is generated. Content outside them is never
 * touched, so hand-written Byobu tweaks in the same file survive an install.
 */

import { ToolError } from "./errors.js";
import { normalizeOptions } from "./format.js";

export const BLOCK_BEGIN = "# >>> pi-behind-byobu >>>";
export const BLOCK_END = "# <<< pi-behind-byobu <<<";

/**
 * The options an install used, recorded inside the block so that later
 * `refresh` and `doctor` runs reuse them instead of falling back to defaults
 * (and quietly undoing `--strip-prefix`, for example).
 */
const OPTIONS_PREFIX = "# options: ";

/**
 * @param {string} format value for `automatic-rename-format`
 * @param {{titlePrefix: string, maxLength: number, stripPrefix: boolean}} options normalized options
 * @returns {string}
 */
export function renderBlock(format, options) {
  return [
    BLOCK_BEGIN,
    "# Managed by pi-behind-byobu: this block is rewritten by `install`.",
    "# Pi publishes its session as the terminal title (OSC 0); Byobu would name the",
    "# window after the running command (node). Let the title win for Pi panes only.",
    `${OPTIONS_PREFIX}${JSON.stringify(options)}`,
    "set -g automatic-rename on",
    `set -g automatic-rename-format '${format}'`,
    BLOCK_END,
  ].join("\n");
}

/**
 * Options recorded in a block, or null when the block predates them or is
 * unreadable.
 *
 * @param {string | null | undefined} block
 * @returns {{titlePrefix: string, maxLength: number, stripPrefix: boolean} | null}
 */
export function parseBlockOptions(block) {
  if (typeof block !== "string") return null;
  const line = block.split("\n").find((candidate) => candidate.startsWith(OPTIONS_PREFIX));
  if (line === undefined) return null;
  try {
    return normalizeOptions(JSON.parse(line.slice(OPTIONS_PREFIX.length)));
  } catch {
    return null;
  }
}

/**
 * @param {string} content
 * @returns {{present: boolean, start: number, end: number}} line indices, end inclusive
 */
function locate(content, label = "config file") {
  const lines = content.split("\n");
  const begins = [];
  const ends = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === BLOCK_BEGIN) begins.push(index);
    else if (trimmed === BLOCK_END) ends.push(index);
  });

  if (begins.length === 0 && ends.length === 0) return { present: false, start: -1, end: -1 };
  if (begins.length === 1 && ends.length === 1 && begins[0] < ends[0]) {
    return { present: true, start: begins[0], end: ends[0] };
  }
  throw new ToolError(
    `Malformed pi-behind-byobu block in ${label}: expected exactly one ` +
      `"${BLOCK_BEGIN}" line followed by one "${BLOCK_END}" line ` +
      `(found ${begins.length} open and ${ends.length} close markers). ` +
      `Fix or delete the block by hand, then re-run.`,
  );
}

/** @returns {boolean} */
export function hasBlock(content) {
  return locate(content).present;
}

/**
 * The managed block as it currently stands in the file, or null.
 *
 * @param {string} content
 * @param {string} [label]
 * @returns {string | null}
 */
export function readBlock(content, label) {
  const state = locate(content, label);
  if (!state.present) return null;
  return content.split("\n").slice(state.start, state.end + 1).join("\n");
}

/**
 * Insert or refresh the managed block.
 *
 * @param {string} content current file content ("" when the file does not exist)
 * @param {string} block rendered block, without trailing newline
 * @param {string} [label] path used in error messages
 * @returns {{content: string, changed: boolean}}
 */
export function upsertBlock(content, block, label) {
  const state = locate(content, label);

  if (!state.present) {
    const separator = content === "" ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    return { content: `${content}${separator}${block}\n`, changed: true };
  }

  const lines = content.split("\n");
  const next = [
    ...lines.slice(0, state.start),
    ...block.split("\n"),
    ...lines.slice(state.end + 1),
  ];
  const updated = next.join("\n");
  return { content: updated, changed: updated !== content };
}

/**
 * @param {string} content
 * @param {string} [label]
 * @returns {{content: string, changed: boolean}}
 */
export function removeBlock(content, label) {
  const state = locate(content, label);
  if (!state.present) return { content, changed: false };

  const lines = content.split("\n");
  const before = lines.slice(0, state.start);
  const after = lines.slice(state.end + 1);

  // Drop the blank separator line we inserted on install, whichever side has one.
  while (
    before.length > 0 &&
    before[before.length - 1].trim() === "" &&
    after.length > 0 &&
    after[0].trim() === ""
  ) {
    after.shift();
  }

  let updated = [...before, ...after].join("\n");
  if (updated.trim() === "") updated = "";
  return { content: updated, changed: updated !== content };
}
