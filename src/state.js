// src/state.js
// ─── State (Atomic read/write with full quest data) ───────────────────────
import { STATE_FILE, STATE_TMP } from './config.js';
import { warn } from './logging.js';
import fs from 'fs';

export function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            if (!state.quests || Array.isArray(state.quests)) state.quests = {};
            return state;
        }
    } catch (err) {
        warn(`Could not read state: ${err.message} — using empty state.`);
    }
    return { quests: {}, last_check: null };
}

export function saveState(state) {
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_TMP, data, 'utf8');
    fs.renameSync(STATE_TMP, STATE_FILE);
}

/**
 * Discord Quest "features" bitfield — decodes config.features (a number[])
 * into readable names.
 */
export const QUEST_FEATURES = {
    0: 'QUEST_BAR',
    1: 'GUILD_ACTIVITY_LINK',
    2: 'DESKTOP_PLAY_ACTIVITY',
    3: 'PROGRESS_BAR_TEXT',
    4: 'VOICE_PROGRESS',
    5: 'VIDEO_PROGRESS',
    6: 'QUEST_DETAILS',
    7: 'QUEST_HOME',
    8: 'QUEST_REWARD_CODE',
    9: 'REWARD_HIGHLIGHTING',
    10: 'FRACTIONS_QUEST',
    11: 'ADDITIONAL_REDEMPTION_INSTRUCTIONS',
    12: 'PACING_V2',
    13: 'DISMISSAL_SURVEY',
    14: 'MOBILE_QUEST_DOCK',
    15: 'QUESTS_CDN',
    16: 'PACING_CONTROLLER',
    17: 'QUEST_HOME_FORCE_STATIC_IMAGE',
    18: 'VIDEO_QUEST_FORCE_HLS_VIDEO',
    19: 'PROGRESS_BAR_ANIMATION',
    20: 'MOBILE_QUEST_HOME',
    21: 'MOBILE_VIDEO_QUEST',
    22: 'QUEST_HOME_V2',
    23: 'MOBILE_PROGRESS_BAR',
};

/** Decode a quest's raw numeric `features` array into readable flag names. */
export function decodeFeatures(featureIds) {
    if (!Array.isArray(featureIds)) return [];
    return featureIds.map(id => QUEST_FEATURES[id] || `UNKNOWN_${id}`);
}

// Same platform derivation as utils.js/embed.js — duplicated (not imported)
// specifically to avoid a state.js <-> utils.js circular import, since
// utils.js imports decodeFeatures from this file.
const PLATFORM_TASK_LABELS = {
    PLAY_ON_DESKTOP: 'PC',
    PLAY_ON_XBOX: 'Xbox',
    PLAY_ON_PLAYSTATION: 'PlayStation',
};
function derivePlatformsFromTasks(tasks) {
    const matched = Object.values(tasks || {})
        .map(t => PLATFORM_TASK_LABELS[t?.type])
        .filter(Boolean);
    return [...new Set(matched)].sort();
}

/**
 * Calculate a hash covering the fields that matter for "did this quest
 * visibly change" — kept in one-for-one sync with what utils.js's
 * detectQuestChanges/buildChangeDescription track and display: duration
 * (starts/expires), reward_expires, features, game (title/publisher),
 * tasks, platforms (derived from tasks), application, and hero_image/
 * hero_video.
 *
 * hero_image/hero_video were added after finding real quests only ever got
 * marked "new" and never "updated" — in practice, Discord swapping a
 * quest's hero image/video asset (a re-encode, thumbnail fix, etc.) turned
 * out to be the single most common thing that actually changes while a
 * quest is live, and it wasn't being tracked at all.
 */
export function hashQuestData(quest) {
    if (!quest) return null;

    const config = quest.config || {};
    const tasks = config.task_config_v2?.tasks || {};

    const critical = {
        quest_name: config.messages?.quest_name,
        game_title: config.messages?.game_title,
        game_publisher: config.messages?.game_publisher,
        application_id: config.application?.id,
        application_name: config.application?.name,

        starts_at: config.starts_at,
        expires_at: config.expires_at,
        reward_expires_at: config.rewards_config?.rewards_expire_at,

        features: Array.isArray(config.features) ? [...config.features].sort((a, b) => a - b) : null,
        platforms: derivePlatformsFromTasks(tasks),

        tasks: Object.keys(tasks)
            .sort()
            .map(key => ({
                key,
                type: tasks[key]?.type,
                target: tasks[key]?.target,
            })),

        hero_image: config.assets?.hero || null,
        hero_video: config.assets?.hero_video || null,
    };

    return Buffer.from(JSON.stringify(critical)).toString('base64');
}
