// src/embed.js
// ─── Embed Builder — 100% Discord Components V2 ────────────────────────────
//
// Matches the exact message spec given:
// - "### {new_quest|updated_quest} - {name}" (H3, not H1)
// - restart note and quest-id lines use "-# " (Discord subtext markdown)
// - a horizontal separator between every distinct section
// - new quest: role ping (if configured) -> title -> hero image ONLY
//   (no video here) -> restart note -> full quest-info block (duration,
//   reward deadline, platforms, game, application, features) -> tasks ->
//   reward (with icon) -> video (only if the quest has a WATCH_VIDEO(_ON_
//   MOBILE) task) -> quest id
// - updated quest: NO role ping ever, NO restart note, NO video — title ->
//   hero image ONLY -> "## Thay đổi" -> changes text -> quest id
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription, derivePlatformsFromTasks } from './utils.js';
import { decodeFeatures } from './state.js';
import { PING_ROLE_ID } from './config.js';
import fs from 'fs/promises';
import path from 'path';

const IS_COMPONENTS_V2 = 1 << 15; // 32768
const CDN_BASE = 'https://cdn.discordapp.com/';
const FALLBACK_ORB_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/orb.png';
const FALLBACK_NITRO_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/nitro.png';

function withWebpFormat(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('format', 'webp');
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Orb/Nitro rewards have no per-reward image of their own — use the fixed
 * fallback icons. Everything else (codes, decorations) uses Discord's own
 * CDN asset for that specific reward, converted to a static image (many
 * decoration assets are .mp4 previews, which render broken as a Thumbnail
 * without this).
 */
function resolveRewardIconUrl(rewardName, primaryReward, assets) {
  const nameLower = String(rewardName || '').toLowerCase();
  if (nameLower.includes('orb')) return FALLBACK_ORB_ICON;
  if (nameLower.includes('nitro')) return FALLBACK_NITRO_ICON;
  if (primaryReward?.asset) return withWebpFormat(`${CDN_BASE}${primaryReward.asset}`);
  return assets?.emptyIconUrl || null;
}

/* ── PLACEHOLDER-aware asset path resolution ────────────────────────────── */

async function readStateFile() {
  try {
    const p = path.resolve(process.cwd(), 'state.json');
    const raw = await fs.readFile(p, 'utf8').catch(() => null);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function resolveAssetPath(assetValue, questId) {
  if (!assetValue) return null;
  const trimmed = String(assetValue).trim();
  if (!trimmed) return null;
  if (/PLACEHOLDER/i.test(trimmed) || trimmed.toLowerCase() === 'placeholder') {
    try {
      const state = await readStateFile();
      const prev = state?.quests?.[questId];
      const prevAssets = prev?.config?.assets || {};
      const candidates = [
        prevAssets.hero,
        prevAssets.hero_video,
        prevAssets.quest_bar_hero,
        prevAssets.quest_bar_hero_video,
        prevAssets.game_tile,
        prevAssets.game_tile_light,
        prevAssets.game_tile_dark,
        prevAssets.logotype,
        prevAssets.logotype_light,
        prevAssets.logotype_dark,
      ];
      for (const c of candidates) {
        if (c && !/PLACEHOLDER/i.test(String(c))) return String(c).trim();
      }
    } catch (e) {
      // ignore
    }
    return null;
  }
  return trimmed;
}

function buildCdnUrl(assetPath) {
  if (!assetPath) return null;
  const s = String(assetPath).trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `${CDN_BASE}${s.replace(/^\/+/, '')}`;
}

/**
 * Video URL comes from the WATCH_VIDEO(_ON_MOBILE) task's own asset — only
 * those task types have `assets.video`, so this returns null for
 * PLAY_ON_DESKTOP/PLAY_ON_XBOX/etc.-only quests, instead of always finding
 * something via a separate config.assets.hero_video field.
 */
function extractTaskVideoUrl(tasks) {
  for (const task of Object.values(tasks || {})) {
    const raw = task?.assets?.video?.url || task?.assets?.video_low_res?.url || task?.assets?.video_hls?.url;
    if (raw) return buildCdnUrl(raw);
  }
  return null;
}

/* ── shared component builders ──────────────────────────────────────────── */

const textDisplay = content => ({ type: 10, content });
const separator = (divider = true, spacing = 1) => ({ type: 14, divider, spacing });

function pushRewardSection(children, { rewardIconUrl, rewardBody }) {
  if (rewardIconUrl) {
    children.push({
      type: 9,
      components: [textDisplay(`## ${i18n.rewards_title}`), textDisplay(rewardBody)],
      accessory: { type: 11, media: { url: rewardIconUrl } },
    });
  } else {
    children.push(textDisplay(`## ${i18n.rewards_title}`));
    children.push(textDisplay(rewardBody));
  }
}

function buildInfoText(config) {
  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
  const rewardExpires = formatDate(config.rewards_config?.rewards_expire_at);
  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationLink = config.application?.link || `https://canary.discord.com/quests`;
  const applicationName = config.application?.name || '';
  const applicationId = config.application?.id || '';
  const platforms = derivePlatformsFromTasks(config.task_config_v2?.tasks).join(', ') || 'Đa nền tảng';
  const featureNames = decodeFeatures(config.features);
  const features = featureNames.length ? featureNames.join(', ') : '—';

  return [
    `**${i18n.duration}:** ${durationStr}`,
    `**${i18n.reward_expires}:** ${rewardExpires}`,
    `**${i18n.platforms}:** ${platforms}`,
    `**${i18n.game}:** ${gameTitle} (${gamePublisher})`,
    `**${i18n.application}:** [${applicationName}](${applicationLink}) (\`${applicationId}\`)`,
    `**${i18n.features}:** ${features}`,
  ].join('\n');
}

/* ── public API ──────────────────────────────────────────────────────────── */

export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;
  const restartNote = i18n.note_restart_app || 'Nếu không thấy nhiệm vụ trong app, thử khởi động lại ứng dụng.';

  const heroPath = await resolveAssetPath(config.assets?.hero || config.assets?.quest_bar_hero, questId);
  const heroUrl = buildCdnUrl(heroPath) || assets?.discordQuests || null;

  const tasks = config.task_config_v2?.tasks || {};
  const videoUrl = extractTaskVideoUrl(tasks);
  const taskCondition = config.task_config_v2?.join_operator || 'or';
  const taskList = Object.values(tasks)
    .map(task => {
      const taskName = String(task.type || '').replace(/_/g, ' ').trim() || 'TASK';
      const minutes = task.target ? Math.round(task.target / 60) : 0;
      // Completion-based task types (ACHIEVEMENT_IN_ACTIVITY, ACHIEVEMENT_IN_GAME)
      // never have a meaningful `target` — showing "(0 phút)" for those (or
      // for anything else where target is genuinely absent) is misleading,
      // so the duration suffix only appears when there's a real value.
      const durationSuffix = minutes > 0 ? ` (${minutes} phút)` : '';
      return `*   ${taskName}${durationSuffix}`;
    })
    .join('\n');

  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '';
  const { rewardType, extraReward, expires: decorExpires } = getReward(primaryReward, rewardName);
  const rewardIconUrl = resolveRewardIconUrl(rewardName, primaryReward, assets);

  const children = [];
  if (PING_ROLE_ID) children.push(textDisplay(`<@&${PING_ROLE_ID}>`));
  else if (content) children.push(textDisplay(content));

  children.push(textDisplay(`### ${i18n.new_quest} - ${questName}`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(separator());
  children.push(textDisplay(`-# *${restartNote}*`));

  children.push(separator());
  children.push(textDisplay(`## ${i18n.quest_info}`));
  children.push(textDisplay(buildInfoText(config)));

  children.push(separator());
  children.push(textDisplay(`## ${i18n.tasks}`));
  children.push(textDisplay(`${i18n.task_condition[taskCondition] || i18n.task_condition.or}\n${taskList}`));

  children.push(separator());
  pushRewardSection(children, {
    rewardIconUrl,
    rewardBody: `**${i18n.reward_type}:** ${rewardType}${decorExpires}\n**${i18n.sku_id}:** \`${skuId}\`\n**${i18n.reward_name.normal}:** ${rewardName}${extraReward}`,
  });

  if (videoUrl) {
    children.push(separator());
    children.push({ type: 12, items: [{ media: { url: videoUrl }, description: questName }] });
  }

  children.push(separator());
  children.push(textDisplay(`-# **${i18n.quest_id}**: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}

/**
 * Updated-quest message — deliberately minimal per spec: no role ping ever
 * (regardless of PING_ROLE_ID/content), no restart note, no video, hero
 * image only, straight to "## Thay đổi".
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
  const config = newQuest?.config;
  if (!config) return null;

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;

  const heroPath = await resolveAssetPath(config.assets?.hero || config.assets?.quest_bar_hero, questId);
  const heroUrl = buildCdnUrl(heroPath) || assets?.discordQuests || null;

  const changesText = buildChangeDescription(oldQuest, newQuest, changes || {}) || i18n.no_changes;

  const children = [];
  children.push(textDisplay(`### ${i18n.updated_quest} - ${questName}`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(separator());
  children.push(textDisplay(`## ${i18n.changes_title}`));
  children.push(textDisplay(changesText));

  children.push(separator());
  children.push(textDisplay(`-# **${i18n.quest_id}**: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}
