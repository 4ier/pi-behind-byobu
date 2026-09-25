import assert from "node:assert/strict";
import test from "node:test";

import { ToolError } from "../src/errors.js";
import { PANE_SEPARATOR, parsePaneListing, parseWindowNames } from "../src/tmux.js";

test("the separator stays printable", () => {
  // tmux 3.4 escapes control characters in format output (0x1f comes back as
  // the literal text "\037"), which silently collapsed every record.
  assert.match(PANE_SEPARATOR, /^[\x20-\x7e]+$/);
});

test("parsePaneListing reads the structured fields", () => {
  const panes = parsePaneListing(
    ["%0|1|0|@0|runnervm", "%1|1|0|@1|π - my-project"].join("\n") + "\n",
  );

  assert.deepEqual(panes, [
    { paneId: "%0", active: "1", inMode: "0", windowId: "@0", title: "runnervm" },
    { paneId: "%1", active: "1", inMode: "0", windowId: "@1", title: "π - my-project" },
  ]);
});

test("parsePaneListing survives a separator inside the title", () => {
  const panes = parsePaneListing("%1|1|0|@1|π - vim foo | ~/code\n");
  assert.equal(panes[0].title, "π - vim foo | ~/code");
  assert.equal(panes[0].windowId, "@1");
});

test("parsePaneListing ignores empty output", () => {
  assert.deepEqual(parsePaneListing(""), []);
});

test("parsePaneListing refuses output it cannot read", () => {
  // Exactly what tmux 3.4 returns for a 0x1f separator: one unparsable field.
  assert.throws(() => parsePaneListing("%1\\037π - my-project\\0371\\0370\\037@1\n"), ToolError);
});

test("parseWindowNames maps ids to names, including separators in names", () => {
  const names = parseWindowNames(["@0|zsh", "@1|π - my-project", "@2|weird | name"].join("\n") + "\n");

  assert.equal(names.get("@0"), "zsh");
  assert.equal(names.get("@1"), "π - my-project");
  assert.equal(names.get("@2"), "weird | name");
  assert.equal(names.size, 3);
});

test("parseWindowNames refuses output it cannot read", () => {
  assert.throws(() => parseWindowNames("@1\\037π - my-project\n"), ToolError);
});

test("parseWindowNames tolerates empty output", () => {
  assert.equal(parseWindowNames("").size, 0);
});
