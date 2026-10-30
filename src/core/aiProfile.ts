/**
 * AI 日推本地偏好画像 (Phase 6)
 * 反馈持久化在 MMKV "ai.Daily"，收藏/播放历史实时读取，不存副本
 */
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

export const AI_DAILY_MMKV_NAME = "ai.Daily";

const store = getOrCreateMMKV(AI_DAILY_MMKV_NAME);

export function getAiDailyStore() {
    return store;
}

export type IAiFeedbackAction = "like" | "dislike";

export interface IAiFeedbackEntry {
    /** platform@id */
    key: string;
    action: IAiFeedbackAction;
    title: string;
    artist: string;
    /** 生成日推时命中的关键词 */
    keyword?: string;
    /** 所属日推日期 YYYY-MM-DD */
    dailyDate?: string;
    ts: number;
}

const FEEDBACK_KEY = "profile";
const FEEDBACK_LIMIT = 200;
const FEEDBACK_WINDOW_MS = 60 * 24 * 3600 * 1000;
const FEEDBACK_PROMPT_LIMIT = 100;
const PROFILE_MAX_CHARS = 600;

function mediaKey(mediaItem: ICommon.IMediaBase) {
    return `${mediaItem.platform}@${mediaItem.id}`;
}

export function getFeedbackEntries(): IAiFeedbackEntry[] {
    const parsed = safeParse<IAiFeedbackEntry[]>(
        store.getString(FEEDBACK_KEY),
    );
    return Array.isArray(parsed)
        ? parsed.filter(it => !!it?.key && !!it?.action)
        : [];
}

function persistFeedback(entries: IAiFeedbackEntry[]) {
    store.set(
        FEEDBACK_KEY,
        safeStringify(entries.slice(0, FEEDBACK_LIMIT)),
    );
}

export function getFeedbackAction(
    musicItem: ICommon.IMediaBase | null | undefined,
): IAiFeedbackAction | null {
    if (!musicItem) {
        return null;
    }
    const key = mediaKey(musicItem);
    return getFeedbackEntries().find(it => it.key === key)?.action ?? null;
}

/** 记录反馈: 同 key 覆盖，最新在前 (再次点击同方向由调用方转为 clearFeedback) */
export function recordFeedback(
    musicItem: IMusic.IMusicItem,
    action: IAiFeedbackAction,
    extra?: { keyword?: string; dailyDate?: string },
) {
    const key = mediaKey(musicItem);
    const entry: IAiFeedbackEntry = {
        key,
        action,
        title: musicItem.title,
        artist: musicItem.artist,
        keyword: extra?.keyword,
        dailyDate: extra?.dailyDate,
        ts: Date.now(),
    };
    persistFeedback([entry, ...getFeedbackEntries().filter(it => it.key !== key)]);
}

export function clearFeedback(musicItem: ICommon.IMediaBase) {
    const key = mediaKey(musicItem);
    persistFeedback(getFeedbackEntries().filter(it => it.key !== key));
}

function splitArtists(artist: string | undefined | null): string[] {
    if (!artist) {
        return [];
    }
    return artist
        .split(/[/、,;&]/)
        .map(it => it.trim())
        .filter(it => it.length > 0);
}

function addScore(map: Map<string, number>, name: string, delta: number) {
    map.set(name, (map.get(name) ?? 0) + delta);
}

function topNames(map: Map<string, number>, limit: number, negative = false) {
    return [...map.entries()]
        .filter(([, score]) => (negative ? score < 0 : score > 0))
        .sort((a, b) => (negative ? a[1] - b[1] : b[1] - a[1]))
        .slice(0, limit)
        .map(([name, score]) => `${name}(${Math.abs(score)})`);
}

interface IProfileSignals {
    favoriteList: IMusic.IMusicItem[];
    historyList: IMusic.IMusicItem[];
    artistScores: Map<string, number>;
    keywordScores: Map<string, number>;
}

/**
 * 实时汇总偏好信号
 * 权重: like +3 / dislike -2 / 收藏 +2 / 历史 +1
 */
function collectProfileSignals(): IProfileSignals {
    const favoriteList = [
        ...MusicSheet.getSortedMusicListBySheetId(MusicSheet.defaultSheet.id)
            .musicList,
    ]
        .sort((a, b) => ((b.$timestamp as number) || 0) - ((a.$timestamp as number) || 0))
        .slice(0, 20);
    const historyList = musicHistory.history.slice(0, 20);
    const now = Date.now();
    const feedbackList = getFeedbackEntries()
        .filter(it => now - it.ts <= FEEDBACK_WINDOW_MS)
        .slice(0, FEEDBACK_PROMPT_LIMIT);

    const artistScores = new Map<string, number>();
    const keywordScores = new Map<string, number>();

    favoriteList.forEach(it => {
        splitArtists(it.artist).forEach(artist => addScore(artistScores, artist, 2));
    });
    historyList.forEach(it => {
        splitArtists(it.artist).forEach(artist => addScore(artistScores, artist, 1));
    });
    feedbackList.forEach(it => {
        const delta = it.action === "like" ? 3 : -2;
        splitArtists(it.artist).forEach(artist => addScore(artistScores, artist, delta));
        if (it.keyword) {
            addScore(keywordScores, it.keyword, delta);
        }
    });

    return { favoriteList, historyList, artistScores, keywordScores };
}

/** 实时构建画像摘要 (≤600 字) */
export function buildProfileSummary(): string {
    const { favoriteList, historyList, artistScores, keywordScores } =
        collectProfileSignals();

    const parts: string[] = [];
    const likedArtists = topNames(artistScores, 8);
    if (likedArtists.length) {
        parts.push(`偏好歌手：${likedArtists.join("、")}`);
    }
    const dislikedArtists = topNames(artistScores, 4, true);
    if (dislikedArtists.length) {
        parts.push(`回避歌手：${dislikedArtists.join("、")}`);
    }
    const likedKeywords = topNames(keywordScores, 6);
    if (likedKeywords.length) {
        parts.push(`偏好关键词：${likedKeywords.join("、")}`);
    }
    const dislikedKeywords = topNames(keywordScores, 4, true);
    if (dislikedKeywords.length) {
        parts.push(`回避关键词：${dislikedKeywords.join("、")}`);
    }
    if (favoriteList.length) {
        parts.push(
            `最近收藏：${favoriteList
                .slice(0, 8)
                .map(it => `${it.title}-${it.artist}`)
                .join("；")}`,
        );
    }
    if (historyList.length) {
        parts.push(
            `最近播放：${historyList
                .slice(0, 8)
                .map(it => `${it.title}-${it.artist}`)
                .join("；")}`,
        );
    }

    const summary = parts.join("。");
    return summary.length > PROFILE_MAX_CHARS
        ? summary.slice(0, PROFILE_MAX_CHARS)
        : summary;
}

export interface IProfileSeeds {
    likedArtists: string[];
    dislikedArtists: string[];
    knownSignatures: Set<string>;
}

function normalizeSignature(title?: string | null, artist?: string | null) {
    const normalizedTitle = (title ?? "").toLowerCase().replace(/\s+/g, "");
    const normalizedArtist = (artist ?? "").toLowerCase().replace(/\s+/g, "");
    return normalizedTitle && normalizedArtist
        ? `${normalizedTitle}|${normalizedArtist}`
        : "";
}

/**
 * 结构化口味种子 (Phase 8)
 * 日推用它做"常听歌手未听曲"的候选生成, 修正关键词瞎搜导致的品味漂移
 */
export function buildProfileSeeds(): IProfileSeeds {
    const { artistScores } = collectProfileSignals();

    const knownSignatures = new Set<string>();
    const addSignature = (title?: string | null, artist?: string | null) => {
        const signature = normalizeSignature(title, artist);
        if (signature) {
            knownSignatures.add(signature);
        }
    };
    MusicSheet.getSortedMusicListBySheetId(
        MusicSheet.defaultSheet.id,
    ).musicList.forEach(it => addSignature(it.title, it.artist));
    musicHistory.history.forEach(it => addSignature(it.title, it.artist));
    getFeedbackEntries().forEach(it => addSignature(it.title, it.artist));

    return {
        likedArtists: topNames(artistScores, 8).map(it =>
            it.replace(/\(\d+\)$/, ""),
        ),
        dislikedArtists: topNames(artistScores, 6, true).map(it =>
            it.replace(/\(\d+\)$/, ""),
        ),
        knownSignatures,
    };
}
