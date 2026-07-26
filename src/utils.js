// src/utils.js
import { i18n } from './language.js';
import { decodeFeatures } from './state.js';

/**
 * Format ISO date to Discord timestamp (date only)
 */
export function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const timestamp = Math.floor(d.getTime() / 1000);
  return `<t:${timestamp}:d>`;
}

/**
 * Format ISO date to Discord timestamp with time
 */
export function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const timestamp = Math.floor(d.getTime() / 1000);
  return `<t:${timestamp}:f>`;
}

/**
 * Get reward info from quest reward object
 */
export function getReward(reward, rewardName) {
  let extraReward = '';
  if (reward?.type === 4 && reward?.premium_orb_quantity) {
    const normalOrbs = String(reward?.orb_quantity || '');
    const premiumOrbs = String(reward?.premium_orb_quantity || '');
    extraReward = `\n**${i18n.reward_name.extra}:** ${String(rewardName).replace(normalOrbs, premiumOrbs)}`;
  }

  let expires = '';
  if (reward?.type === 3 && reward?.expires_at) {
    expires = `\n**${i18n.decor_expires}:** ${formatDate(reward?.expires_at)}`;
  }

  const keyword = Object.keys(i18n.rewards).find(key => reward?.type == key);
  return {
    rewardType: i18n.rewards[String(keyword)] || i18n.error.reward_type,
    extraReward,
    expires
  };
}

/**
 * The only real signal for which platforms a quest supports is which
 * PLAY_ON_* task keys it has — there's no reliable top-level platforms
 * field. Shared by detectQuestChanges/buildChangeDescription here and by
 * embed.js's own "Nền tảng nhận" line, so both always agree.
 */
const PLATFORM_TASK_LABELS = {
  PLAY_ON_DESKTOP: 'PC',
  PLAY_ON_XBOX: 'Xbox',
  PLAY_ON_PLAYSTATION: 'PlayStation',
};
export function derivePlatformsFromTasks(tasks) {
  const matched = Object.values(tasks || {})
    .map(t => PLATFORM_TASK_LABELS[t?.type])
    .filter(Boolean);
  return [...new Set(matched)];
}

/**
 * Compares tasks by their (type, target) content only — ignores the object
 * keys Discord assigns and their order.
 */
function taskSignature(tasks) {
  return Object.values(tasks || {})
    .map(t => `${t?.type || ''}:${t?.target || 0}`)
    .sort()
    .join('|');
}

function summarizeTasks(tasks) {
  return (
    Object.values(tasks || {})
      .map(t => {
        const name = String(t?.type || '').replace(/_/g, ' ');
        const minutes = t?.target ? Math.round(t.target / 60) : 0;
        return `${name} (${minutes} phút)`;
      })
      .join(', ') || '—'
  );
}

/**
 * Compare two quests and detect changes. Kept in one-for-one sync with
 * state.js's hashQuestData: duration, reward_expires, features, game,
 * tasks, platforms, application, and hero_image/hero_video (the most
 * common real-world change — see state.js for why this was added).
 */
export function detectQuestChanges(oldQuest, newQuest) {
  const changes = {
    quest_name: false,
    duration: false,
    reward_expires: false,
    features: false,
    game: false,
    tasks: false,
    platforms: false,
    application: false,
    visuals: false,
  };

  const oldConfig = (oldQuest && oldQuest.config) ? oldQuest.config : (oldQuest || {});
  const newConfig = newQuest?.config || {};

  if ((oldConfig.messages?.quest_name || '') !== (newConfig.messages?.quest_name || '')) {
    changes.quest_name = true;
  }

  if (
    (oldConfig.starts_at || '') !== (newConfig.starts_at || '') ||
    (oldConfig.expires_at || '') !== (newConfig.expires_at || '')
  ) {
    changes.duration = true;
  }

  if ((oldConfig.rewards_config?.rewards_expire_at || '') !== (newConfig.rewards_config?.rewards_expire_at || '')) {
    changes.reward_expires = true;
  }

  const oldFeatures = Array.isArray(oldConfig.features) ? [...oldConfig.features].sort((a, b) => a - b).join(',') : '';
  const newFeatures = Array.isArray(newConfig.features) ? [...newConfig.features].sort((a, b) => a - b).join(',') : '';
  if (oldFeatures !== newFeatures) {
    changes.features = true;
  }

  if (
    (oldConfig.messages?.game_title || '') !== (newConfig.messages?.game_title || '') ||
    (oldConfig.messages?.game_publisher || '') !== (newConfig.messages?.game_publisher || '')
  ) {
    changes.game = true;
  }

  const oldTasks = oldConfig.task_config_v2?.tasks || {};
  const newTasks = newConfig.task_config_v2?.tasks || {};
  if (taskSignature(oldTasks) !== taskSignature(newTasks)) {
    changes.tasks = true;
  }

  const oldPlatforms = derivePlatformsFromTasks(oldTasks).join(',');
  const newPlatforms = derivePlatformsFromTasks(newTasks).join(',');
  if (oldPlatforms !== newPlatforms) {
    changes.platforms = true;
  }

  if (
    (oldConfig.application?.id || '') !== (newConfig.application?.id || '') ||
    (oldConfig.application?.name || '') !== (newConfig.application?.name || '')
  ) {
    changes.application = true;
  }

  if (
    (oldConfig.assets?.hero || '') !== (newConfig.assets?.hero || '') ||
    (oldConfig.assets?.hero_video || '') !== (newConfig.assets?.hero_video || '')
  ) {
    changes.visuals = true;
  }

  return changes;
}

/**
 * Build change description text — one "~~old~~ → new" line per changed
 * category, reusing the SAME plain i18n labels as the quest-info section.
 * `visuals` (hero image/video swapped) deliberately shows a clean, generic
 * notice rather than dumping raw asset file paths — those are internal
 * implementation details (a re-encode, a thumbnail fix) that aren't
 * meaningful to a reader, unlike an actual date or reward changing.
 */
export function buildChangeDescription(oldQuest, newQuest, changes) {
  const oldConfig = (oldQuest && oldQuest.config) ? oldQuest.config : (oldQuest || {});
  const newConfig = newQuest?.config || {};
  const lines = [];

  if (changes?.duration) {
    const oldRange = `${formatDateTime(oldConfig.starts_at) || '—'} - ${formatDateTime(oldConfig.expires_at) || '—'}`;
    const newRange = `${formatDateTime(newConfig.starts_at) || '—'} - ${formatDateTime(newConfig.expires_at) || '—'}`;
    lines.push(`**${i18n.duration}**: ~~${oldRange}~~\n→ ${newRange}`);
  }

  if (changes?.reward_expires) {
    const oldVal = formatDateTime(oldConfig.rewards_config?.rewards_expire_at) || '—';
    const newVal = formatDateTime(newConfig.rewards_config?.rewards_expire_at) || '—';
    lines.push(`**${i18n.reward_expires}**: ~~${oldVal}~~\n→ ${newVal}`);
  }

  if (changes?.features) {
    const oldF = decodeFeatures(oldConfig.features).join(', ') || '—';
    const newF = decodeFeatures(newConfig.features).join(', ') || '—';
    lines.push(`**${i18n.features}**: ~~${oldF}~~ → ${newF}`);
  }

  if (changes?.game) {
    const oldG = `${oldConfig.messages?.game_title || i18n.error.game_name} (${oldConfig.messages?.game_publisher || i18n.error.game_publisher})`;
    const newG = `${newConfig.messages?.game_title || i18n.error.game_name} (${newConfig.messages?.game_publisher || i18n.error.game_publisher})`;
    lines.push(`**${i18n.game}**: ~~${oldG}~~ → ${newG}`);
  }

  if (changes?.tasks) {
    const oldT = summarizeTasks(oldConfig.task_config_v2?.tasks);
    const newT = summarizeTasks(newConfig.task_config_v2?.tasks);
    lines.push(`**${i18n.tasks}**: ~~${oldT}~~ → ${newT}`);
  }

  if (changes?.platforms) {
    const oldP = derivePlatformsFromTasks(oldConfig.task_config_v2?.tasks).join(', ') || '—';
    const newP = derivePlatformsFromTasks(newConfig.task_config_v2?.tasks).join(', ') || '—';
    lines.push(`**${i18n.platforms}**: ~~${oldP}~~ → ${newP}`);
  }

  if (changes?.application) {
    const oldA = oldConfig.application?.name || '—';
    const newA = newConfig.application?.name || '—';
    lines.push(`**${i18n.application}**: ~~${oldA}~~ → ${newA}`);
  }

  if (changes?.visuals) {
    lines.push(`**${i18n.visuals_changed || '🎬 Hình ảnh / Video'}**: ${i18n.visuals_updated || 'Đã được cập nhật'}`);
  }

  return lines.join('\n\n');
}
