// src/webhook.js
import fetch from 'node-fetch';
import FormData from 'form-data';
import { error, log, warn } from './logging.js';

const DEFAULT_MAX_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES) || 16 * 1024 * 1024; // 16MB
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WEBHOOK_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a remote asset as a Buffer.
 */
async function fetchBufferFromUrl(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'image/*,video/*;q=0.9,*/*;q=0.8',
      },
    });

    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const length = Number(res.headers.get('content-length')) || buffer.length;
      return { buffer, length };
    }

    if ((res.status === 403 || res.status === 429) && attempt < retries) {
      const waitMs = 500 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Failed to fetch asset ${url}: ${res.status}`);
  }
}

/**
 * Build the final webhook URL, appending query params Discord requires.
 */
function buildWebhookUrl(webhookUrl, payload) {
  const url = new URL(webhookUrl);
  if (payload?.wait) url.searchParams.append('wait', 'true');
  if (Array.isArray(payload?.components) && payload.components.length > 0) {
    url.searchParams.append('with_components', 'true');
  }
  return url;
}

/**
 * POST to a webhook URL with retry-with-backoff on 429.
 *
 * This was the actual cause of "many new quests but only ~5 get sent":
 * Discord's webhook rate limit (a handful of messages per short window) has
 * no retry logic here before — a 429 just threw immediately, main.js logged
 * an error and moved to the NEXT quest without retrying the one that just
 * failed, so everything after the rate limit kicked in was silently
 * dropped for that run (though it would be retried on the next scheduled
 * run, since a failed send never gets saved to state — this fix means it
 * usually won't even need to wait for that).
 */
async function postWithRetries(url, options, retries = WEBHOOK_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    if (res.status === 429 && attempt < retries) {
      let retryAfter = res.headers.get('retry-after');
      if (!retryAfter) {
        try {
          const bodyClone = await res.clone().json();
          if (bodyClone?.retry_after) retryAfter = bodyClone.retry_after;
        } catch (e) {
          // not JSON or already consumed
        }
      }
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 1000 * (attempt + 1);
      warn(`Webhook 429 — retrying ${attempt + 1}/${retries} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

/**
 * Send webhook payload with optional attachments.
 * Returns true on success, false on failure.
 */
export async function sendWebhook(webhookUrl, payload, attachments = []) {
  if (!webhookUrl) {
    error('Webhook URL is empty');
    return false;
  }

  try {
    if (!attachments || attachments.length === 0) {
      const url = buildWebhookUrl(webhookUrl, payload);

      const res = await postWithRetries(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_USER_AGENT,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Webhook error ${res.status}: ${body}`);
      }
      return true;
    }

    // Build multipart form-data
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));

    let fileIndex = 0;
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (!att || !att.url) continue;
      try {
        const { buffer, length } = await fetchBufferFromUrl(att.url);
        if (length > DEFAULT_MAX_BYTES) {
          log(`Attachment ${att.filename || att.url} too large (${length} bytes), skipping attachment.`);
          continue;
        }
        const name = att.filename || `file_${fileIndex}`;
        form.append(`files[${fileIndex}]`, buffer, {
          filename: name,
          contentType: att.contentType || 'application/octet-stream',
        });
        fileIndex++;
      } catch (err) {
        error(`Failed to fetch attachment ${att.url}: ${err.message}`);
      }
    }

    const url = buildWebhookUrl(webhookUrl, payload);

    const res = await postWithRetries(url.toString(), {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Webhook error ${res.status}: ${body}`);
    }

    return true;
  } catch (err) {
    error(`Failed to send webhook: ${err.message}`);
    return false;
  }
}

/**
 * Send error notice to ERROR_WEBHOOK (keeps previous behavior)
 */
export async function sendErrorNotice(message) {
  const { ERROR_WEBHOOK } = await import('./config.js');
  if (!ERROR_WEBHOOK) return;

  const payload = {
    username: 'Uh Oh :(((',
    content: `\`\`\`\n${message}\n\`\`\``,
  };

  await sendWebhook(ERROR_WEBHOOK, payload, []);
}
