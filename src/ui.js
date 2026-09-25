/** Minimal terminal output helpers; colour is disabled for pipes and NO_COLOR. */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

/**
 * @param {{quiet?: boolean, tty?: boolean, env?: NodeJS.ProcessEnv, write?: (text: string) => void}} [options]
 */
export function createUi({
  quiet = false,
  tty = process.stdout.isTTY === true,
  env = process.env,
  write = (text) => process.stdout.write(text),
} = {}) {
  const useColor = tty && !env.NO_COLOR && env.TERM !== "dumb";
  const paint = (code, text) => (useColor ? `${code}${text}${ANSI.reset}` : text);

  return {
    useColor,
    /** Informational line, suppressed by --quiet. */
    out: (text = "") => {
      if (!quiet) write(`${text}\n`);
    },
    blank: () => {
      if (!quiet) write("\n");
    },
    heading: (text) => write(`\n${paint(ANSI.bold, text)}\n`),
    detail: (label, value) => write(`  ${paint(ANSI.dim, label.padEnd(12))}${value}\n`),
    ok: (text) => write(`  ${paint(ANSI.green, "ok")}    ${text}\n`),
    warn: (text) => write(`  ${paint(ANSI.yellow, "warn")}  ${text}\n`),
    fail: (text) => write(`  ${paint(ANSI.red, "fail")}  ${text}\n`),
    note: (text) => write(`        ${paint(ANSI.dim, text)}\n`),
  };
}
