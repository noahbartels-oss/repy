#!/usr/bin/env node
// PSN short-name availability checker.
//
// Walks every combination of a character set for a given length, asks PSN
// whether a profile already exists for it, and records the ones that look
// free. Designed to run for a long time: it rate-limits itself, retries on
// transient errors, refreshes its auth token, and can resume where it left off.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAuthorization } from "./src/auth.js";
import { checkAvailability } from "./src/check.js";
import { generate, configSignature, PRESETS } from "./src/generate.js";

const STATE_FILE = new URL("./.progress.json", import.meta.url);

function parseArgs(argv) {
  const opts = {
    length: 4,
    charset: PRESETS.letters,
    delay: 1300, // ms between requests — be gentle with PSN
    limit: Infinity, // max candidates to check this run
    out: "available.txt",
    reset: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--length":
      case "-n":
        opts.length = Number(next());
        break;
      case "--charset":
        opts.charset = next();
        break;
      case "--letters":
        opts.charset = PRESETS.letters;
        break;
      case "--alnum":
        opts.charset = PRESETS.letters + PRESETS.digits;
        break;
      case "--all":
        opts.charset = PRESETS.letters + PRESETS.digits + PRESETS.symbols;
        break;
      case "--delay":
        opts.delay = Number(next());
        break;
      case "--limit":
        opts.limit = Number(next());
        break;
      case "--out":
        opts.out = next();
        break;
      case "--reset":
        opts.reset = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`PSN short-name availability checker

Usage: node index.js [options]

Options:
  -n, --length <n>   Name length (default: 4)
  --charset <chars>  Custom set of characters to combine
  --letters          Use a-z (default)
  --alnum            Use a-z and 0-9
  --all              Use a-z, 0-9, hyphen and underscore
  --delay <ms>       Delay between requests (default: 1300)
  --limit <n>        Max names to check this run (default: unlimited)
  --out <file>       File to append available names to (default: available.txt)
  --reset            Ignore saved progress and start over
  -h, --help         Show this help

Auth: set the NPSSO env var or put your token in a file named npsso.txt.
      See the README for how to get an NPSSO token.`);
}

async function loadNpsso() {
  if (process.env.NPSSO) return process.env.NPSSO.trim();
  try {
    return (await readFile(new URL("./npsso.txt", import.meta.url), "utf8")).trim();
  } catch {
    return null;
  }
}

async function loadProgress(signature, reset) {
  if (reset) return { signature, done: 0 };
  try {
    const state = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (state.signature === signature) return state;
    console.log("Config changed since last run — starting fresh.");
  } catch {
    /* no saved progress */
  }
  return { signature, done: 0 };
}

async function saveProgress(signature, done) {
  await writeFile(STATE_FILE, JSON.stringify({ signature, done }, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Check one name, retrying on transient/rate-limit errors with backoff.
async function checkWithRetry(getAuth, name, baseDelay) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const authorization = await getAuth();
      return await checkAvailability(authorization, name);
    } catch (err) {
      const status = err?.response?.status ?? err?.status;
      const isLast = attempt === maxAttempts;
      const isRateLimit = status === 429;
      const wait = isRateLimit
        ? baseDelay * 2 ** attempt + 5000
        : baseDelay * 2 ** attempt;
      if (isLast) {
        console.warn(`  ! "${name}" failed after ${maxAttempts} attempts: ${err.message}`);
        return "error";
      }
      console.warn(
        `  ~ "${name}" error (${status ?? err.message}); retry ${attempt}/${maxAttempts} in ${Math.round(
          wait / 1000,
        )}s`,
      );
      await sleep(wait);
    }
  }
  return "error";
}

async function main() {
  const opts = parseArgs(process.argv);
  const signature = configSignature(opts.charset, opts.length);

  const npsso = await loadNpsso();
  // Cache the authorization and let getAuthorization refresh it as needed.
  const getAuth = () => getAuthorization(npsso);
  try {
    await getAuth();
  } catch (err) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const progress = await loadProgress(signature, opts.reset);
  const outUrl = new URL(opts.out, import.meta.url);

  console.log(
    `Checking length-${opts.length} names from "${opts.charset}" ` +
      `(starting at #${progress.done}, delay ${opts.delay}ms).`,
  );
  if (existsSync(outUrl)) {
    console.log(`Appending available names to ${opts.out} (existing file kept).`);
  }

  let index = 0; // position in the deterministic candidate stream
  let checkedThisRun = 0;
  let availableThisRun = 0;
  let stopping = false;

  process.on("SIGINT", () => {
    console.log("\nStopping after current name… (progress is saved)");
    stopping = true;
  });

  for (const name of generate(opts.charset, opts.length)) {
    if (index < progress.done) {
      index++;
      continue; // already checked in a previous run
    }
    if (stopping || checkedThisRun >= opts.limit) break;

    const status = await checkWithRetry(getAuth, name, opts.delay);
    checkedThisRun++;
    index++;

    if (status === "available") {
      availableThisRun++;
      console.log(`  ✓ AVAILABLE: ${name}`);
      await appendFile(outUrl, name + "\n");
    } else if (status === "taken") {
      process.stdout.write(`  · ${name} taken\r`);
    }

    // Persist progress (only advance past names we actually resolved).
    if (status !== "error") {
      await saveProgress(signature, index);
    }

    await sleep(opts.delay);
  }

  console.log(
    `\nDone for now: checked ${checkedThisRun} names this run, ` +
      `${availableThisRun} available. Total processed: ${index}.`,
  );
  console.log(`Available names are in ${opts.out}. Re-run to continue where you left off.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
