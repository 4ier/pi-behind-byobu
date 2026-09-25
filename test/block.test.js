import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_BEGIN,
  BLOCK_END,
  hasBlock,
  readBlock,
  removeBlock,
  renderBlock,
  upsertBlock,
} from "../src/block.js";
import { ToolError } from "../src/errors.js";

const FORMAT = "#{?#{m:*π -*,#{pane_title}},#{=24:#{pane_title}},#{pane_current_command}}";
const BLOCK = renderBlock(FORMAT);

const USER_CONFIG = `# my byobu tweaks
set -g status-interval 1
setw -g window-status-separator '  '
`;

test("renderBlock produces the managed block", () => {
  const lines = BLOCK.split("\n");
  assert.equal(lines[0], BLOCK_BEGIN);
  assert.equal(lines.at(-1), BLOCK_END);
  assert.ok(lines.includes("set -g automatic-rename on"));
  assert.ok(lines.includes(`set -g automatic-rename-format '${FORMAT}'`));
});

test("upsertBlock creates the file content when empty", () => {
  const { content, changed } = upsertBlock("", BLOCK);
  assert.equal(content, `${BLOCK}\n`);
  assert.equal(changed, true);
  assert.equal(hasBlock(content), true);
});

test("upsertBlock keeps surrounding user configuration and separates it", () => {
  const { content } = upsertBlock(USER_CONFIG, BLOCK);
  assert.ok(content.startsWith(USER_CONFIG));
  assert.ok(content.includes(`\n\n${BLOCK_BEGIN}`));
  assert.equal(readBlock(content), BLOCK);
});

test("upsertBlock is idempotent", () => {
  const first = upsertBlock(USER_CONFIG, BLOCK);
  const second = upsertBlock(first.content, BLOCK);
  assert.equal(second.content, first.content);
  assert.equal(second.changed, false);
});

test("upsertBlock replaces a stale block in place", () => {
  const stale = renderBlock("old-format");
  const withStale = upsertBlock(USER_CONFIG, stale).content;
  const { content, changed } = upsertBlock(withStale, BLOCK);

  assert.equal(changed, true);
  assert.equal(readBlock(content), BLOCK);
  assert.ok(!content.includes("old-format"));
  assert.equal(content.match(new RegExp(BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")).length, 1);
});

test("removeBlock restores the original file", () => {
  const installed = upsertBlock(USER_CONFIG, BLOCK).content;
  const removed = removeBlock(installed);
  assert.equal(removed.changed, true);
  assert.equal(removed.content, USER_CONFIG);
  assert.equal(hasBlock(removed.content), false);
});

test("removeBlock is a no-op without a block", () => {
  const removed = removeBlock(USER_CONFIG);
  assert.equal(removed.changed, false);
  assert.equal(removed.content, USER_CONFIG);
});

test("removeBlock leaves an empty file empty", () => {
  const installed = upsertBlock("", BLOCK).content;
  assert.equal(removeBlock(installed).content, "");
});

test("removeBlock tolerates missing trailing newline in the original", () => {
  const installed = upsertBlock("# only line", BLOCK).content;
  assert.equal(removeBlock(installed).content, "# only line\n");
});

test("a single open marker is reported instead of silently eating the file", () => {
  const broken = `# user config\n${BLOCK_BEGIN}\nset -g automatic-rename on\n`;
  assert.throws(() => upsertBlock(broken, BLOCK, "test.conf"), ToolError);
  assert.throws(() => removeBlock(broken, "test.conf"), ToolError);
});

test("duplicate blocks are reported", () => {
  const doubled = `${upsertBlock("", BLOCK).content}${upsertBlock("", BLOCK).content}`;
  assert.throws(() => hasBlock(doubled), ToolError);
});
