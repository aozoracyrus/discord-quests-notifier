# 🎮 Discord Quests Notifier

**Advanced Discord Quests tracker with automatic update detection and webhook notifications**

Track new Discord Quests and changes in real-time, including quests that are region-locked away from your own account.

![Status](https://img.shields.io/badge/Status-Working-brightgreen)
![Node](https://img.shields.io/badge/Node-20+-blue)
![License](https://img.shields.io/badge/License-MIT-green)

> **DISCLAIMER**: This project is for educational and personal monitoring purposes only. Using Discord user tokens violates Discord's Terms of Service and may result in permanent account suspension. Use entirely at your own risk.

---

## 🚀 Features

✅ **Real-time Quest Tracking** — fetches Discord quests every 3 hours (configurable via the workflow's cron schedule)   
✅ **Hidden/Region-Locked Quest Discovery** — merges in a public quests dump so you see quests your own account/region can't, with no proxy needed (see below)   
✅ **New Quest Notifications** — instant webhook alerts for newly discovered quests   
✅ **Update Detection** — detects changes in quest details (dates, rewards, tasks, platforms, application, visuals)   
✅ **Change Highlighting** — shows exactly what changed in quest updates, without dumping raw internal file paths   
✅ **Atomic State Management** — safe data persistence with atomic file writes   
✅ **Role Mentions** — optional Discord role pinging for new quests only (update notices never ping)   
✅ **Internationalization** — support for multiple languages (en-US, vi-VN)   
✅ **GitHub Actions** — free 24/7 cloud hosting   
✅ **Error Tracking** — optional error webhook for debugging   
✅ **Components V2** — 100% Discord Components V2 messages (no legacy embeds), with images, video, and reward icons   

---

## 🌐 Hidden/Region-Locked Quest Discovery

Discord Quests can be locked to specific regions — your own account may never see them via a direct connection. Instead of running proxies to fake a different region, this tracker merges in a public quests dump (maintained by another tracker) that already includes those quests.

- Controlled by the `EXTERNAL_QUESTS_URL` environment variable (see Configuration below). Defaults to a public dump; set it to an empty string to disable merging entirely and run direct-only.
- The dump can include expired quests — harmless, since expired quests are filtered out the same way regardless of source.
- Your own direct connection's data always takes priority over the dump for any quest both sources see (the dump is only used to fill in quests direct can't see at all).
- This fully replaces the previous proxy-based approach (proxy.json, `PROXY_LIST`, `PROXY_LIST_URL`) — those are no longer used. If you have a `proxy.json` file or `PROXY_LIST`/`PROXY_LIST_URL` secrets from an older setup, they can be safely deleted/removed.

---

## 📋 Installation

### Method 1: GitHub Actions (Recommended — Free & 24/7)

**Step 1: Create Repository**

1. Fork or create a new repository named `discord-quests-notifier`
2. Clone it locally or use GitHub's web editor

**Step 2: Configure Secrets** — Go to **Settings** → **Secrets and variables** → **Actions**

Add these **Secrets** (click "New repository secret"):

| Secret          | Description                        | Example                                |
| --------------- | ----------------------------------- | --------------------------------------- |
| `DISCORD_TOKEN` | Your Discord user token             | `MzA4M...`                              |
| `MAIN_WEBHOOK`  | Webhook for quest notifications     | `https://discord.com/api/webhooks/...`  |
| `ERROR_WEBHOOK` | Webhook for error logs (optional)   | `https://discord.com/api/webhooks/...`  |

Add these **Variables** (click "New repository variable"):

| Variable             | Description                                     | Example                                            |
| -------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `LOCALE`              | Language for messages                           | `en-US` or `vi-VN`                                 |
| `PING_ROLE_ID`        | Role ID to mention on new quests (optional)     | `123456789`                                         |
| `EXTERNAL_QUESTS_URL` | Override the hidden-quest dump URL (optional)   | leave unset to use the default, or `""` to disable |

**Step 3: Enable Actions**

1. Go to **Actions** tab
2. Enable GitHub Actions (if disabled)
3. Select "Discord Quest Tracker" workflow
4. Click "Run workflow"

✅ Done! The bot will run automatically on the schedule set in `.github/workflows/questsTracker.yml` (every 3 hours by default).

---

### Method 2: Self-Hosted (VPS/Localhost)

**Step 1: Clone Repository**

```
git clone https://github.com/yourusername/discord-quests-notifier.git
cd discord-quests-notifier
```

**Step 2: Install Dependencies**

```
npm install
```

**Step 3: Configure Environment**

```
cp .env.example .env
```

Edit `.env`:

```
DISCORD_TOKEN="YOUR_TOKEN"
MAIN_WEBHOOK="https://discord.com/api/webhooks/..."
ERROR_WEBHOOK="https://discord.com/api/webhooks/..."
GITHUB_TOKEN="ghp_..."
REPOSITORY="yourname/discord-quests-notifier"
LOCALE="en-US"
PING_ROLE_ID=""
EXTERNAL_QUESTS_URL=""
```

**Step 4: Run Tracker**

```
node src/main.js
```

**Step 5: Schedule Recurring Task**

Using PM2 (recommended):

```
npm install -g pm2
pm2 start src/main.js --cron "0 */3 * * *"
pm2 save
pm2 startup
```

Or using crontab:

```
crontab -e
# Add: 0 */3 * * * cd /path/to/repo && node src/main.js
```

## 📊 How It Works

```
Every 3 Hours (GitHub Actions or Cron)
        ↓
Fetch external hidden-quest dump (optional, best-effort)
        ↓
Discord API: Fetch /quests/@me (direct connection)
        ↓
Merge + dedupe by quest id (direct always wins over the dump)
        ↓
Compare with state.json
        ↓
┌─────────────────────────────┐
│  NEW QUEST FOUND?           │
│  ├─ Send notification       │
│  ├─ Mention role (if set)   │
│  └─ Save to state.json      │
└─────────────────────────────┘
        ↓
┌─────────────────────────────┐
│  QUEST UPDATED?             │
│  ├─ Detect changes          │
│  ├─ Send update alert (never pings) │
│  ├─ Highlight what changed  │
│  └─ Update state.json       │
└─────────────────────────────┘
        ↓
Cleanup expired quests from state
        ↓
Save state + Commit to GitHub (if Actions)
```

## 🗂️ Project Structure

```
discord-quests-notifier/
├── src/
│   ├── main.js              ← Main tracker logic
│   ├── config.js            ← Configuration & env vars
│   ├── discord.js           ← Discord API client + hidden-quest dump merge
│   ├── embed.js             ← Embed builders (new & updated), 100% Components V2
│   ├── state.js             ← State management (atomic writes) + change hashing
│   ├── webhook.js           ← Webhook sender (retries on Discord rate limits)
│   ├── logging.js           ← Logging utilities
│   ├── language.js          ← i18n initialization
│   ├── utils.js             ← Helper functions + change detection
│   ├── module.js            ← Module exports
│   └── languages/
│       ├── en-US.json       ← English strings
│       └── vi-VN.json       ← Vietnamese strings
├── .github/workflows/
│   └── questsTracker.yml    ← GitHub Actions workflow
├── .env.example             ← Environment template
├── package.json
├── package-lock.json
├── state.json               ← Quest state (auto-managed)
└── README.md
```

## 📝 state.json Format

The `state.json` file automatically tracks all active quests:

```
{
  "quests": {
    "QUEST_ID": {
      "id": "1234567890",
      "config": { /* full quest config */ },
      "hash": "base64hashofcriticalfields",
      "starts_at": "2026-07-01T17:00:00Z",
      "expires_at": "2026-08-13T00:00:00Z",
      "sent_at": "2026-07-08T13:28:35Z",
      "updated_at": "2026-07-08T15:30:00Z",
      "type": "new" | "updated"
    }
  },
  "last_check": "2026-07-08T09:35:46Z"
}
```

**Manual Management**:

- **Reset All**: Clear the `quests` object → bot will resend all active quests
- **Reset One Quest**: Delete a specific quest ID → bot will resend only that quest
- **View History**: Check `sent_at` and `updated_at` timestamps

**⚠️ Files are written atomically to `state.tmp.json` first, then renamed to `state.json`. This prevents data corruption if the script crashes.**

## 🔄 Quest Change Detection

The tracker compares every field below against the previous run, and only sends an "updated quest" notification (with only the lines that actually changed) when at least one of them differs:

✅ Quest duration (start/end date)   
✅ Reward claim deadline   
✅ Feature flags   
✅ Game title / publisher   
✅ Tasks (type and duration)   
✅ Platforms (derived from which tasks are present)   
✅ Application name/id   
✅ Hero image / hero video (shown as a clean "updated" notice — the specific internal file path is never shown, since that's an implementation detail Discord swaps around often and isn't meaningful on its own)   

## 🌍 Supported Languages

- 🇺🇸 English (`en-US`)
- 🇻🇳 Vietnamese (`vi-VN`)

Set the `LOCALE` environment variable to switch languages.

## 🛠️ Configuration

**Environment Variables**

| Variable              | Required | Default                              | Description                                          |
| ---------------------- | -------- | -------------------------------------- | ------------------------------------------------------ |
| `DISCORD_TOKEN`        | ✅        | `-`                                    | Your Discord user token                                |
| `MAIN_WEBHOOK`         | ✅        | `-`                                    | Webhook URL for quest notifications                    |
| `ERROR_WEBHOOK`        | ❌        | `-`                                    | Webhook URL for error alerts                           |
| `GITHUB_TOKEN`         | ✅        | `-`                                    | GitHub PAT (for committing state)                      |
| `REPOSITORY`           | ✅        | `-`                                    | Repository in format `owner/repo`                      |
| `LOCALE`               | ❌        | `en-US`                                | Language: `en-US` or `vi-VN`                           |
| `PING_ROLE_ID`         | ❌        | `-`                                    | Discord role ID to mention on new quests only          |
| `EXTERNAL_QUESTS_URL`  | ❌        | a public hidden-quest dump (built in) | Set to `""` to disable merging in hidden/locked quests |

## 📦 Assets

The project uses assets from the `assets/` directory on your repository:

- `avatar.png` — bot avatar for webhooks
- `empty.png` — fallback image for rewards with no icon of their own
- `discordQuests.png` — fallback hero image for quests missing their own
- `orb.png` — fallback icon for Orb rewards
- `nitro.png` — fallback icon for Nitro rewards

## 🐛 Troubleshooting

**Token Issues**   
**Error**: `Discord API 401: Unauthorized`   
❌ Token is invalid or expired   
✅ Generate a new user token (Discord DevTools Console: `localStorage.token`)   

**Webhook Errors**   
**Error**: `Webhook error 404`   
❌ Webhook URL is incorrect or deleted   
✅ Recreate the webhook in Discord and update secrets   

**Webhook Errors (429)**   
❌ Discord's webhook rate limit was hit while sending many quests in one run   
✅ The tracker retries automatically with backoff — if you still see quests missing after a run, they'll be picked up as "new" again on the next scheduled run, since a failed send never gets saved to state   

**State Issues**   
**Issue**: Bot stops sending notifications   
❌ `state.json` is corrupted, or every quest is always detected as "new" and never "updated"   
✅ Delete `state.json` to let it be recreated on the next run; if updates specifically never trigger, check that the fields you care about are covered under Quest Change Detection above   

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 😍 Acknowledgements

- A special thank you to those who helped me create and refine "Discord Quest Notifier."
- [@mc-none-vn](https://github.com/mc-none-vn) — the person who created the repository, helped me with the work and creation process.

## 📄 License

MIT License — See LICENSE file for details

## ⚠️ Legal Disclaimer

This project is provided as-is for educational purposes. Users assume full responsibility for compliance with Discord's Terms of Service. We are not liable for account suspensions or bans resulting from misuse.

Built with ❤️ by Korchi Community
