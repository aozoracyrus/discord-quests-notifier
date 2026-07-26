// src/discord.js
import { DISCORD_TOKEN } from './config.js';
import { warn, error, log } from './logging.js';

const DEFAULT_RETRIES = 3;
const RETRY_BASE_MS = 800;

// Default source for a public dump of quests (including ones region-locked
// away from this account) maintained by another tracker. Configurable via
// EXTERNAL_QUESTS_URL in case this ever moves/goes away — set it to an
// empty string to disable merging entirely.
const DEFAULT_EXTERNAL_QUESTS_URL =
  'https://raw.githubusercontent.com/BachLe2000/funny-tracker/refs/heads/main/quests.json';

/**
 * Simple sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper with retries for transient errors (429, 5xx).
 * Reads retry_after from the header, falling back to the JSON body (Discord
 * includes it in both, but the header is occasionally missing).
 */
async function fetchWithRetries(url, options = {}, retries = DEFAULT_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (attempt <= retries) {
        const waitMs = RETRY_BASE_MS * attempt;
        warn(`Network error fetching ${url} — retrying ${attempt}/${retries} after ${waitMs}ms: ${err.message}`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }

    if (res.ok) return res;

    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt <= retries) {
      let retryAfter = res.headers.get('retry-after');
      if (!retryAfter && res.status === 429) {
        try {
          const bodyClone = await res.clone().json();
          if (bodyClone?.retry_after) retryAfter = bodyClone.retry_after;
        } catch (e) {
          // not JSON or already consumed — ignore
        }
      }
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : RETRY_BASE_MS * attempt;
      warn(`Discord API ${res.status} — retrying attempt ${attempt}/${retries} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

/**
 * Internal helper to perform the actual API call and parse JSON.
 */
async function callQuestsApi() {
  const url = 'https://discord.com/api/v9/quests/@me';
  const headers = {
    Authorization: DISCORD_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'X-Super-Properties': Buffer.from(JSON.stringify({
      os: 'Windows',
      browser: 'Chrome',
      device: '',
    })).toString('base64'),
  };

  const res = await fetchWithRetries(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}: ${body}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Failed to parse Discord response JSON: ${err.message}`);
  }

  if (Array.isArray(data.quests)) return data.quests;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data?.quests)) return data.quests;
  return [];
}

/**
 * Fetch a public quests dump (e.g. funny-tracker's quests.json) and convert
 * it into the same { id, config } shape used everywhere else in this
 * codebase. The dump stores each quest's config fields flattened at the top
 * level (with a redundant `id` field alongside them) rather than nested
 * under `.config`, so that gets un-flattened here.
 *
 * This file can be large (includes expired quests going back a long way) —
 * expired ones are harmless here since main.js already filters anything
 * with expires_at in the past, same as it does for quests from the direct
 * connection.
 */
async function fetchExternalQuestsDump(url) {
  if (!url) return [];
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      warn(`External quests dump fetch failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];

    const quests = [];
    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object') continue;
      const { id: innerId, ...config } = value;
      const id = String(innerId || key);
      if (!id) continue;
      quests.push({ id, config });
    }
    return quests;
  } catch (err) {
    warn(`External quests dump error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch quests for the authorized account.
 *
 * Always direct connection only — no proxies. Additionally merges in an
 * external public quests dump (see fetchExternalQuestsDump) to surface
 * quests that are region-locked away from this account, without needing
 * any proxy infrastructure. Direct connection's own data always wins over
 * the external dump for any quest id both sources have, since it's fresher.
 */
export async function fetchQuests() {
  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is not set');
  }

  const questsById = new Map();
  const mergeIn = (quests, sourceLabel) => {
    let newCount = 0;
    for (const q of quests) {
      if (!q?.id) continue;
      if (!questsById.has(q.id)) newCount++;
      questsById.set(q.id, q);
    }
    if (sourceLabel) log(`${sourceLabel}: ${quests.length} quest(s) (${newCount} new).`);
  };

  // External dump first (may include hidden/region-locked quests) — merged
  // in before direct, so direct's fresher data overwrites any overlap.
  const externalUrl = process.env.EXTERNAL_QUESTS_URL ?? DEFAULT_EXTERNAL_QUESTS_URL;
  if (externalUrl) {
    const external = await fetchExternalQuestsDump(externalUrl);
    if (external.length) mergeIn(external, 'External quests dump');
  }

  // Direct connection — the only way this now fetches Discord's API.
  const direct = await callQuestsApi();
  mergeIn(direct, 'Direct connection');

  const merged = Array.from(questsById.values());
  log(`Merged total: ${merged.length} unique quest(s).`);
  return merged;
}
