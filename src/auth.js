// PSN authentication with on-disk token caching and automatic refresh.
import { readFile, writeFile } from "node:fs/promises";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
} from "psn-api";

const TOKEN_FILE = new URL("../.tokens.json", import.meta.url);

// Treat a token as expired this many seconds before its real expiry,
// so we never fire a request with a token that dies mid-flight.
const EXPIRY_SAFETY_MARGIN_SEC = 60;

async function readCache() {
  try {
    return JSON.parse(await readFile(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const cache = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: now + tokens.expiresIn,
    refreshTokenExpiresAt: now + tokens.refreshTokenExpiresIn,
  };
  await writeFile(TOKEN_FILE, JSON.stringify(cache, null, 2));
  return cache;
}

function isExpired(epochSeconds) {
  return Math.floor(Date.now() / 1000) >= epochSeconds - EXPIRY_SAFETY_MARGIN_SEC;
}

async function authFromNpsso(npsso) {
  const accessCode = await exchangeNpssoForAccessCode(npsso);
  const tokens = await exchangeAccessCodeForAuthTokens(accessCode);
  return writeCache(tokens);
}

/**
 * Returns a valid AuthorizationPayload ({ accessToken }) for psn-api calls.
 * Uses a cached token when possible, refreshes it when expired, and only
 * falls back to the NPSSO token when there is no usable refresh token.
 */
export async function getAuthorization(npsso) {
  let cache = await readCache();

  if (cache && !isExpired(cache.accessTokenExpiresAt)) {
    return { accessToken: cache.accessToken };
  }

  if (cache && !isExpired(cache.refreshTokenExpiresAt)) {
    try {
      const tokens = await exchangeRefreshTokenForAuthTokens(cache.refreshToken);
      cache = await writeCache(tokens);
      return { accessToken: cache.accessToken };
    } catch {
      // Refresh failed (revoked, etc.) — fall through to NPSSO login.
    }
  }

  if (!npsso) {
    throw new Error(
      "No valid token cache and no NPSSO provided. Set the NPSSO env var or create an npsso.txt file. " +
        "See the README for how to obtain your NPSSO token.",
    );
  }

  cache = await authFromNpsso(npsso);
  return { accessToken: cache.accessToken };
}
