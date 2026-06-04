// Optional Discord webhook notifications for available-name hits.
//
// Enabled when a webhook URL is provided via the DISCORD_WEBHOOK env var or a
// discord_webhook.txt file. Failures never interrupt the checking run.

import { readFile } from "node:fs/promises";

let webhookUrl;

/** Resolves the webhook URL once (env var wins, then file). "" = disabled. */
async function resolveWebhook() {
  if (webhookUrl !== undefined) return webhookUrl;
  if (process.env.DISCORD_WEBHOOK) {
    webhookUrl = process.env.DISCORD_WEBHOOK.trim();
    return webhookUrl;
  }
  try {
    webhookUrl = (await readFile(new URL("../discord_webhook.txt", import.meta.url), "utf8")).trim();
  } catch {
    webhookUrl = "";
  }
  return webhookUrl;
}

export async function notifyEnabled() {
  return Boolean(await resolveWebhook());
}

/**
 * Sends an "available name" alert to Discord. Best-effort: any error (bad URL,
 * network, rate limit) is swallowed with a warning so the run keeps going.
 * Respects a single Discord 429 retry_after before giving up on this message.
 */
export async function notifyAvailable(name, { mode, score } = {}) {
  const url = await resolveWebhook();
  if (!url) return;

  const detail = [mode && `mode: ${mode}`, score != null && `score: ${score}`]
    .filter(Boolean)
    .join(" · ");
  const content = `🎯 **Available PSN name:** \`${name}\`${detail ? `\n${detail}` : ""}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      });
      if (res.status === 429 && attempt === 0) {
        const body = await res.json().catch(() => ({}));
        const waitMs = Math.min((body.retry_after ?? 1) * 1000, 5000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue; // retry once after the rate-limit window
      }
      if (!res.ok) console.warn(`  ~ Discord notify failed (HTTP ${res.status})`);
      return;
    } catch (err) {
      console.warn(`  ~ Discord notify error: ${err.message}`);
      return;
    }
  }
}
