#!/usr/bin/env node
/**
 * Validates the security-audit waiver files:
 *
 *   contracts/.cargo/audit.toml   `[advisories] ignore` (cargo audit)
 *   frontend/audit-ci.jsonc       `allowlist`           (npm audit via audit-ci)
 *
 * Every waived advisory must carry a justification, a tracking link, and a
 * review-by date, so that no advisory is silenced without an owner and an
 * expiry. See docs/security-triage.md.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const WAIVER_FILES = [
  {
    path: "contracts/.cargo/audit.toml",
    listKey: "ignore",
    tool: "cargo audit",
  },
  {
    path: "frontend/audit-ci.jsonc",
    listKey: "allowlist",
    tool: "npm audit (audit-ci)",
  },
];

const COMMENT = /^\s*(?:#|\/\/)\s?/;
const FIELDS = ["Justification", "Link", "Review-by"];

const stripComment = (line) => line.replace(COMMENT, "").trimEnd();

const isComment = (line) => COMMENT.test(line);

/**
 * Extracts the quoted strings inside `<listKey> ... [ ... ]`, ignoring any
 * commented-out entries so that a waiver documented but not yet active does
 * not read as active.
 */
export const parseListedIds = (text, listKey) => {
  const keyIndex = text.search(new RegExp(`["']?${listKey}["']?\\s*[:=]`));
  if (keyIndex === -1) {
    throw new Error(`Missing "${listKey}" list`);
  }

  const open = text.indexOf("[", keyIndex);
  const close = text.indexOf("]", open);
  if (open === -1 || close === -1) {
    throw new Error(`Malformed "${listKey}" list`);
  }

  return text
    .slice(open + 1, close)
    .split("\n")
    .filter((line) => !isComment(line))
    .flatMap((line) =>
      [...line.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]),
    );
};

/**
 * Parses `WAIVER:` comment blocks. A block is a run of consecutive comment
 * lines starting with `WAIVER: <id>` and followed by its required fields.
 */
export const parseWaiverBlocks = (text) => {
  const lines = text.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!isComment(lines[index])) continue;

    const header = stripComment(lines[index]).match(/^WAIVER:\s*(\S+)\s*$/);
    if (!header) continue;

    const block = { id: header[1], line: index + 1, fields: {} };

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!isComment(lines[cursor])) break;

      const body = stripComment(lines[cursor]);
      if (/^WAIVER:/.test(body)) break;

      const field = body.match(/^([A-Za-z-]+):\s*(.+)$/);
      if (field && FIELDS.includes(field[1])) {
        block.fields[field[1]] = field[2].trim();
      }
      index = cursor;
    }

    blocks.push(block);
  }

  return blocks;
};

const isIsoDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Cross-checks the active list against the documented waiver blocks.
 * Returns `{ errors, expired }` — errors are always fatal, expired waivers are
 * fatal only for the periodic review job (`--fail-on-expired`).
 */
export const validateWaivers = ({ text, listKey, label, today }) => {
  const errors = [];
  const expired = [];

  const ids = parseListedIds(text, listKey);
  const blocks = parseWaiverBlocks(text);
  const documented = new Map(blocks.map((block) => [block.id, block]));

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push(`${label}: "${id}" is listed more than once in ${listKey}`);
      continue;
    }
    seen.add(id);

    const block = documented.get(id);
    if (!block) {
      errors.push(
        `${label}: "${id}" is waived in ${listKey} but has no "# WAIVER: ${id}" block`,
      );
      continue;
    }

    for (const field of FIELDS) {
      if (!block.fields[field]) {
        errors.push(
          `${label}:${block.line}: waiver "${id}" is missing "${field}:"`,
        );
      }
    }

    const reviewBy = block.fields["Review-by"];
    if (reviewBy && !isIsoDate(reviewBy)) {
      errors.push(
        `${label}:${block.line}: waiver "${id}" has an invalid Review-by date "${reviewBy}" (expected YYYY-MM-DD)`,
      );
    } else if (reviewBy && reviewBy < today) {
      expired.push(
        `${label}:${block.line}: waiver "${id}" was due for re-triage on ${reviewBy}`,
      );
    }
  }

  for (const block of blocks) {
    if (!seen.has(block.id)) {
      errors.push(
        `${label}:${block.line}: waiver block "${block.id}" has no matching entry in ${listKey} (remove the block or re-add the entry)`,
      );
    }
  }

  return { errors, expired, count: seen.size };
};

export const checkAuditWaivers = async ({
  root = repoRoot,
  files = WAIVER_FILES,
  today,
} = {}) => {
  const errors = [];
  const expired = [];
  const summary = [];

  for (const file of files) {
    const label = relative(root, resolve(root, file.path)) || file.path;
    let text;
    try {
      text = await readFile(resolve(root, file.path), "utf8");
    } catch {
      errors.push(`${label}: waiver file is missing`);
      continue;
    }

    try {
      const result = validateWaivers({ ...file, text, label, today });
      errors.push(...result.errors);
      expired.push(...result.expired);
      summary.push(
        `${label}: ${result.count} active waiver(s) for ${file.tool}`,
      );
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  return { errors, expired, summary };
};

export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

const main = async () => {
  const failOnExpired = process.argv.includes("--fail-on-expired");
  const { errors, expired, summary } = await checkAuditWaivers({
    today: todayIso(),
  });

  for (const line of summary) console.log(line);

  for (const error of errors) console.error(`error: ${error}`);
  for (const line of expired) {
    console.error(`${failOnExpired ? "error" : "warning"}: ${line}`);
  }

  if (expired.length > 0) {
    console.error(
      "\nExpired waivers must be re-triaged: confirm the advisory still does " +
        "not affect StellarForge and extend Review-by, or remove the waiver and " +
        "fix the dependency. See docs/security-triage.md.",
    );
  }

  if (errors.length > 0 || (failOnExpired && expired.length > 0)) {
    process.exitCode = 1;
    return;
  }

  console.log("Audit waivers OK");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
