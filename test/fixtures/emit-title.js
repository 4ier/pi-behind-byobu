/** Emits a Pi-style terminal title, then echoes every stdin line as a new title.
 *
 * Used by the integration test to prove that (a) an already-running Pi window
 * gets renamed by `install`, and (b) later title changes - Pi's `/rename` -
 * keep propagating.
 */

const initial = process.argv[2] ?? "π - fixture";

process.stdout.write(`\x1b]0;${initial}\x07`);

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  // A tty delivers lines with \n (the driver maps CR), but accept \r too.
  const lines = buffer.split(/\r\n|\r|\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const title = line.trim();
    if (title !== "") process.stdout.write(`\x1b]0;${title}\x07`);
  }
});

process.stdin.resume();
setTimeout(() => {}, 60_000);
