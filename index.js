#!/usr/bin/env node
// PSN short-name availability checker / sniping bot.
//
// Generates candidate online IDs (pronounceable, dictionary words, brandable
// patterns, or brute force), asks PSN whether a profile already exists, and
// records the free ones. Curated modes check the highest brand-scored names
// first. The run is rate-limited, retries on errors, refreshes its auth token
// and resumes where it left off.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getAuthorization } from "./src/auth.js";
import { checkAvailability } from "./src/check.js";
import { buildCandidates, loadWords, PRESETS } from "./src/generate.js";
import { scoreName } from "./src/score.js";
import { notifyAvailable, notifyEnabled } from "./src/notify.js";

const STATE_FILE = new URL("./.progress.json", import.meta.url);

function parseArgs(argv) {
  const opts = {
    mode: "brandable", // brandable | pattern | words | brute
    length: 4,
    charset: PRESETS.letters,
    patterns: ["CVCV"],
    top: Infinity,
    delay: 1300, // ms between requests — be gentle with PSN
    limit: Infinity, // max candidates to check this run
    out: "available.txt",
    reset: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--brandable":
        opts.mode = "brandable";
        break;
      case "--words":
        opts.mode = "words";
        break;
      case "--brute":
        opts.mode = "brute";
        break;
      case "--pattern":
        opts.mode = "pattern";
        opts.patterns = next()
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        break;
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
      case "--top":
        opts.top = Number(next());
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
  console.log(`PSN short-name checker / sniping bot

Usage: node index.js [mode] [options]

Modes (pick one; default: --brandable):
  --brandable        Curated pronounceable patterns (nexo, lumi, zaro...)
  --pattern <list>   Custom templates, comma-separated. Symbols:
                       C=consonant V=vowel L=letter D=digit A=alphanumeric
                       e.g. --pattern CVCV,CVCD
  --words            Real dictionary words of the given length
  --brute            Every combination of a character set (huge!)

Options:
  -n, --length <n>   Name length (default: 4)
  --top <n>          Only check the best-scored N candidates (curated modes)
  --charset <chars>  Custom characters for --brute
  --letters          --brute over a-z (default)
  --alnum            --brute over a-z and 0-9
  --all              --brute over a-z, 0-9, hyphen, underscore
  --delay <ms>       Delay between requests (default: 1300)
  --limit <n>        Max names to check this run (default: unlimited)
  --out <file>       File to append available names to (default: available.txt)
  --reset            Ignore saved progress and start over
  -h, --help         Show this help

Examples:
  node index.js                      # best 4-letter brandable names first
  node index.js --pattern CVCV       # all consonant-vowel-consonant-vowel
  node index.js --pattern CVCD       # like "zar7": letter-vowel-letter-digit
  node index.js --words              # real 4-letter words
  node index.js --brandable --top 200  # only the 200 most valuable candidates

Auth: set the NPSSO env var or put your token in a file named npsso.txt.
Discord: set DISCORD_WEBHOOK env var or create discord_webhook.txt to get an
         alert for every available name found.`);
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
    console.log("Config changed since last run — starting fresh for this config.");
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
      const wait = isRateLimit ? baseDelay * 2 ** attempt + 5000 : baseDelay * 2 ** attempt;
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

  let plan;
  try {
    plan = buildCandidates(opts);
  } catch (err) {
    console.error(`Could not build candidates: ${err.message}`);
    process.exit(1);
  }

  const npsso = await loadNpsso();
  const getAuth = () => getAuthorization(npsso);
  try {
    await getAuth();
  } catch (err) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const progress = await loadProgress(plan.signature, opts.reset);
  const outUrl = new URL(opts.out, import.meta.url);
  const totalLabel = plan.total === null ? "?" : plan.total;
  const words = loadWords();
  if (await notifyEnabled()) console.log("Discord notifications: enabled.");

  console.log(
    `Mode: ${plan.mode} | length ${opts.length} | ${totalLabel} candidates | ` +
      `delay ${opts.delay}ms | starting at #${progress.done}.`,
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

  for (const name of plan.candidates) {
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
      await notifyAvailable(name, { mode: plan.mode, score: scoreName(name, words) });
    } else if (status === "taken") {
      const pos = plan.total === null ? `#${index}` : `${index}/${plan.total}`;
      process.stdout.write(`  · ${pos} ${name} taken          \r`);
    }

    // Only advance saved progress past names we actually resolved.
    if (status !== "error") await saveProgress(plan.signature, index);

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
