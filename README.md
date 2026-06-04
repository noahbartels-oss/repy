# PSN Short-Name Checker

A command-line tool that checks whether short **PlayStation Network (PSN)
online IDs** — for example all 4-letter names — currently have a profile
attached. Names with no profile are written to a file so you can review them.

## How it works

For every combination of a character set (e.g. `aaaa` … `zzzz`), the tool asks
PSN's universal search whether a profile with that exact online ID exists:

- **No profile found** → reported as `available` (written to `available.txt`).
- **Exact profile found** → `taken`.

The run is rate-limited, retries on transient errors, refreshes its login
token automatically, and **resumes where it left off** if you stop and restart.

> ⚠️ **Important caveats**
> - "Available" means *no public profile exists*. PSN can still **reserve**,
>   **temporarily hold** (recently deleted), or **ban** a name — so this is a
>   strong hint, not a guarantee that you can actually register it.
> - Automated querying and reselling online IDs may violate the
>   [PlayStation Network Terms of Service](https://www.playstation.com/legal/psn-terms-of-service/).
>   Use a delay, don't hammer the service, and understand the risk to your
>   account. You are responsible for how you use this.

## Setup

```bash
npm install
```

### Get your NPSSO token

The tool needs to authenticate as your PSN account:

1. Log in to <https://www.playstation.com> in your browser.
2. In the same browser, open
   <https://ca.account.sony.com/api/v1/ssocookie>.
3. You'll see JSON like `{"npsso":"<64-character-token>"}`. Copy the token.

Provide it in **one** of these ways:

```bash
# Option A: environment variable
export NPSSO="your-64-character-token"

# Option B: a file (it's git-ignored)
echo "your-64-character-token" > npsso.txt
```

The token is exchanged for access/refresh tokens that are cached in
`.tokens.json`, so you usually only need the NPSSO once. If it stops working,
grab a fresh NPSSO and run again.

## Usage

```bash
# Default: all 4-letter (a-z) names
node index.js

# 3-letter names
node index.js --length 3

# 4 characters, letters + digits
node index.js --alnum

# Everything PSN allows (letters, digits, - and _)
node index.js --all

# Go slower / faster (milliseconds between requests)
node index.js --delay 2000

# Only check 500 names this run, then stop
node index.js --limit 500

# Start over from scratch
node index.js --reset
```

Run `node index.js --help` for the full option list.

### Output

- `available.txt` — newline-separated list of names that look free (appended to).
- `.progress.json` — how far the current config has progressed (used to resume).
- `.tokens.json` — cached auth tokens.

All three are git-ignored.

## Notes on scale

- 4 letters = 26⁴ = **456,976** names. At a 1.3s delay that's roughly **7 days**
  of continuous running. Use `--limit` to do it in chunks, or raise/lower
  `--delay` at your own risk. The tool resumes, so you can stop and restart.
- Keep the delay reasonable. Aggressive querying risks rate-limiting or your
  account being flagged.
