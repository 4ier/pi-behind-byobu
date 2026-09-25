/**
 * Structure checks for CHANGELOG.md.
 *
 * Keep a Changelog files are hand-edited, and a hand edit is exactly how this
 * project once shipped a section with no date and a version whose compare link
 * was missing. CI now fails instead.
 */

const HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const LINK = /^\[([^\]]+)\]: (\S+)$/;

/** @returns {string[]} problems, empty when the changelog is coherent */
export function validateChangelog({ text, version, repo }) {
  const problems = [];
  const lines = text.split("\n");

  const unreleasedCount = lines.filter((line) => line.trim() === "## [Unreleased]").length;
  if (unreleasedCount !== 1) {
    problems.push(`expected exactly one "## [Unreleased]" heading, found ${unreleasedCount}`);
  }

  const headings = [];
  const links = new Map();
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) headings.push({ version: heading[1], date: heading[2] });
    else if (/^## \[/.test(line) && line.trim() !== "## [Unreleased]") {
      problems.push(`malformed version heading (want "## [x.y.z] - YYYY-MM-DD"): ${line}`);
    }

    const link = LINK.exec(line);
    if (link) links.set(link[1], link[2]);
  }

  if (headings.length === 0) {
    problems.push("no released version section found");
  } else {
    if (headings[0].version !== version) {
      problems.push(
        `package.json is ${version} but the newest changelog section is ${headings[0].version}`,
      );
    }
    for (let i = 1; i < headings.length; i += 1) {
      const [a, b] = [headings[i - 1].version, headings[i].version];
      if (compare(a, b) <= 0) problems.push(`version sections are not in descending order: ${a} then ${b}`);
    }
    const seen = new Set();
    for (const { version: v } of headings) {
      if (seen.has(v)) problems.push(`duplicate version section ${v}`);
      seen.add(v);
    }
  }

  if (headings.length > 0) {
    const expected = `${repo}/compare/v${headings[0].version}...HEAD`;
    if (!links.has("Unreleased")) {
      problems.push('missing the "[Unreleased]:" compare link');
    } else if (links.get("Unreleased") !== expected) {
      problems.push(`"[Unreleased]:" should point at ${expected}, found ${links.get("Unreleased")}`);
    }
    for (const { version: v } of headings) {
      if (!links.has(v)) problems.push(`missing the "[${v}]:" compare link`);
    }
  }

  return problems;
}

function compare(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
