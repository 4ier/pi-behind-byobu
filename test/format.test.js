import assert from "node:assert/strict";
import test from "node:test";

import { UsageError } from "../src/errors.js";
import {
  DEFAULT_MAX_LENGTH,
  DEFAULT_STRIP_PREFIX,
  DEFAULT_TITLE_PREFIX,
  STOCK_AUTOMATIC_RENAME_FORMAT,
  buildAutomaticRenameFormat,
  normalizeOptions,
  preferredWindowName,
  titleMatchPattern,
} from "../src/format.js";

test("defaults", () => {
  assert.equal(DEFAULT_TITLE_PREFIX, "π");
  assert.equal(DEFAULT_MAX_LENGTH, 24);
  assert.equal(DEFAULT_STRIP_PREFIX, true);
  assert.deepEqual(normalizeOptions(), {
    titlePrefix: "π",
    maxLength: 24,
    stripPrefix: true,
  });
  // Explicitly asked for, either way round.
  assert.equal(normalizeOptions({ stripPrefix: false }).stripPrefix, false);
  assert.equal(normalizeOptions({ stripPrefix: true }).stripPrefix, true);
});

test("titleMatchPattern requires Pi's separator, not just the glyph", () => {
  assert.equal(titleMatchPattern(), "*π -*");
  assert.equal(titleMatchPattern("PI"), "*PI -*");
});

test("buildAutomaticRenameFormat: default drops Pi's prefix", () => {
  assert.equal(
    buildAutomaticRenameFormat(),
    `#{?#{m:*π -*,#{pane_title}},#{=24:#{s/^.*π - //:pane_title}},${STOCK_AUTOMATIC_RENAME_FORMAT}}`,
  );
});

test("buildAutomaticRenameFormat: --keep-prefix keeps it", () => {
  assert.equal(
    buildAutomaticRenameFormat({ stripPrefix: false }),
    `#{?#{m:*π -*,#{pane_title}},#{=24:#{pane_title}},${STOCK_AUTOMATIC_RENAME_FORMAT}}`,
  );
});

test("buildAutomaticRenameFormat: truncation can be disabled", () => {
  assert.equal(
    buildAutomaticRenameFormat({ maxLength: 0, stripPrefix: false }),
    `#{?#{m:*π -*,#{pane_title}},#{pane_title},${STOCK_AUTOMATIC_RENAME_FORMAT}}`,
  );
  assert.equal(
    buildAutomaticRenameFormat({ maxLength: 0 }),
    `#{?#{m:*π -*,#{pane_title}},#{s/^.*π - //:pane_title},${STOCK_AUTOMATIC_RENAME_FORMAT}}`,
  );
});

test("buildAutomaticRenameFormat: strip-prefix substitutes before truncating", () => {
  assert.equal(
    buildAutomaticRenameFormat({ stripPrefix: true, maxLength: 12 }),
    `#{?#{m:*π -*,#{pane_title}},#{=12:#{s/^.*π - //:pane_title}},${STOCK_AUTOMATIC_RENAME_FORMAT}}`,
  );
});

test("buildAutomaticRenameFormat: keeps tmux's stock fallback for other programs", () => {
  const format = buildAutomaticRenameFormat();
  assert.ok(format.endsWith(`,#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}}`));
});

test("buildAutomaticRenameFormat: escapes a literal # in the prefix for tmux", () => {
  // `#` is tmux's format escape character, so a literal one has to be doubled.
  assert.ok(buildAutomaticRenameFormat({ titlePrefix: "π" }).includes("*π -*"));
  assert.match(titleMatchPattern("a"), /^\*a -\*$/);
});

test("normalizeOptions rejects prefixes that would break the tmux format", () => {
  for (const bad of ["", "   ", "π#", "π:", "π,", "π/", "π'", "π{", "π}", "π*", "π\\"]) {
    assert.throws(() => normalizeOptions({ titlePrefix: bad }), UsageError, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("normalizeOptions rejects a non-integer or negative max length", () => {
  for (const bad of [-1, 2.5, Number.NaN]) {
    assert.throws(() => normalizeOptions({ maxLength: bad }), UsageError);
  }
});

test("preferredWindowName mirrors the tmux expression", () => {
  // Default: Pi's prefix goes away, the session name stays.
  assert.equal(preferredWindowName("π - session - cwd"), "session - cwd");
  assert.equal(preferredWindowName("π - session - cwd", { maxLength: 8 }), "session ");
  assert.equal(preferredWindowName("π - session - cwd", { stripPrefix: false }), "π - session - cwd");
  assert.equal(preferredWindowName("⠋ π - session - cwd", { maxLength: 10 }), "session - ");
});

test("preferredWindowName ignores non-Pi panes", () => {
  for (const title of [
    "fourierdeMacBook-Air.local",
    "pi - notpi",
    "4top",
    "π-no-separator",
    "zsh",
    "",
  ]) {
    assert.equal(preferredWindowName(title, {}), null, `expected ${JSON.stringify(title)} to be ignored`);
  }
  assert.equal(preferredWindowName(undefined), null);
});

test("preferredWindowName truncates by code point, like tmux", () => {
  // "π - " is four code points, so a 5-character budget keeps one more.
  assert.equal(preferredWindowName("π - 你好世界你好世界", { maxLength: 1 }), "你");
  assert.equal(preferredWindowName("π - 你好世界你好世界", { maxLength: 2 }), "你好");
  assert.equal(Array.from(preferredWindowName("π - 你好世界你好世界", { maxLength: 2 })).length, 2);
});
