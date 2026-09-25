import assert from "node:assert/strict";
import test from "node:test";

import { validateChangelog } from "../scripts/check-changelog.mjs";

const REPO = "https://github.com/4ier/pi-behind-byobu";

function changelog({
  unreleased = "## [Unreleased]\n\n### Added\n\n- something",
  sections = "## [1.2.0] - 2026-09-25\n\n### Fixed\n\n- a fix",
  links = `[Unreleased]: ${REPO}/compare/v1.2.0...HEAD\n[1.2.0]: ${REPO}/compare/v1.1.0...v1.2.0`,
  extraLinks = "",
} = {}) {
  return `${unreleased}\n\n${sections}\n\n${links}${extraLinks}\n`;
}

const validate = (text, version = "1.2.0") => validateChangelog({ text, version, repo: REPO });

test("a coherent changelog has no problems", () => {
  assert.deepEqual(
    validate(
      changelog({
        sections:
          "## [1.2.0] - 2026-09-25\n\n### Fixed\n\n- a fix\n\n## [1.1.0] - 2026-09-01\n\n### Added\n\n- a feature",
        links: `[Unreleased]: ${REPO}/compare/v1.2.0...HEAD\n[1.2.0]: ${REPO}/compare/v1.1.0...v1.2.0\n[1.1.0]: ${REPO}/compare/v1.0.0...v1.1.0`,
      }),
    ),
    [],
  );
});

test("the unreleased heading must exist exactly once", () => {
  assert.match(validate(changelog({ unreleased: "" })).join("\n"), /exactly one "## \[Unreleased\]"/);
});

test("a version heading must carry a date", () => {
  const problems = validate(changelog({ sections: "## [1.2.0]\n\n### Fixed\n\n- a fix" }));
  assert.match(problems.join("\n"), /malformed version heading/);
});

test("package.json and the newest section cannot drift apart", () => {
  const problems = validate(changelog(), "1.3.0");
  assert.match(problems.join("\n"), /package\.json is 1\.3\.0 but the newest changelog section is 1\.2\.0/);
});

test("duplicate and out-of-order sections are rejected", () => {
  const problems = validate(
    changelog({
      sections:
        "## [1.1.0] - 2026-09-01\n\n- old\n\n## [1.2.0] - 2026-09-25\n\n- new\n\n## [1.2.0] - 2026-09-26\n\n- dup",
    }),
  );
  const text = problems.join("\n");
  assert.match(text, /not in descending order/);
  assert.match(text, /duplicate version section 1\.2\.0/);
});

test("compare links are required and must point at the newest release", () => {
  const wrong = validate(
    changelog({ links: `[Unreleased]: ${REPO}/compare/v1.1.0...HEAD\n[1.2.0]: ${REPO}/compare/v1.1.0...v1.2.0` }),
  );
  assert.match(wrong.join("\n"), /"\[Unreleased\]:" should point at .*v1\.2\.0\.\.\.HEAD/);

  const missing = validate(changelog({ links: `[1.2.0]: ${REPO}/compare/v1.1.0...v1.2.0` }));
  assert.match(missing.join("\n"), /missing the "\[Unreleased\]:" compare link/);

  const noVersionLink = validate(changelog({ links: `[Unreleased]: ${REPO}/compare/v1.2.0...HEAD` }));
  assert.match(noVersionLink.join("\n"), /missing the "\[1\.2\.0\]:" compare link/);
});
