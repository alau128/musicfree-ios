/**
 * AI 日推 (Phase 8)
 * 口味锚定: 收藏/历史 Top 歌手 → 搜其未听曲目占主体;
 * AI 关键词只保留少量探索位, 修正纯关键词搜歌导致的品味漂移。
 * 真实歌曲由音源插件搜索 + getMediaSource 验源, 保证可播。
 * 链路只走本地模型 (llama.rn)，音源搜索是唯一网络流量。
 */
import {
    buildProfileSeeds,
    buildProfileSummary,
    getAiDailyStore,
    getFeedbackEntries,
} from "@/core/aiProfile";
import MusicSheet from "@/core/musicSheet";
import pluginManager from "@/core/pluginManager";
import type { Plugin } from "@/core/pluginManager";
import {
    getLastInitError,
    initLocalLlama,
    localCompletion,
    subscribeLlamaInitProgress,
} from "@/pages/aiChat/llamaService";
import { parseFirstJsonObject } from "@/utils/aiJsonParse";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import Network from "@/utils/network";
import { atom, getDefaultStore } from "jotai";

const store = getAiDailyStore();

const RECORDS_KEY = "records";
const LAST_GENERATED_KEY = "lastGeneratedDate";
const AUTO_ATTEMPT_KEY = "autoAttemptDate";
const RECORD_LIMIT = 14;

const MAX_KEYWORDS = 6;
const MIN_KEYWORDS = 4;
const SEARCH_PER_KEYWORD = 6;
const MAX_HITS_TOTAL = 15;
const MIN_HITS = 5;
const DEGRADED_HITS = 12;
const MAX_SEED_ARTISTS = 7;
const SEED_CANDIDATES = 10;
const SEED_HITS_PER_ARTIST = 2;
const MAX_PER_ARTIST = 2;
const EXPLORATION_KEYWORDS = 2;
const MAX_EXPLORATION_HITS_PER_KEYWORD = 2;
const COLD_START_KEYWORDS = 4;
const MAX_EXPLORATION_HITS_COLD_START = 3;
const SEED_CONCURRENCY = 2;
const SEARCH_TIMEOUT = 12_000;
const SOURCE_TIMEOUT = 10_000;
const TOTAL_BUDGET = 150_000;
const DISLIKE_WINDOW_MS = 60 * 24 * 3600 * 1000;

export type IAiDailyErrorCode =
    | "NOT_READY"
    | "OFFLINE"
    | "NO_PLUGIN"
    | "MODEL_UNAVAILABLE"
    | "INVALID_OUTPUT"
    | "SEARCH_EMPTY"
    | "SAVE_FAILED"
    | "UNKNOWN";

export type IAiDailyStatus =
    | { state: "idle" }
    | {
          state: "generating";
          stage: "model-init" | "thinking" | "searching" | "saving";
          progress?: number;
          detail?: string;
      }
    | {
          state: "done";
          date: string;
          sheetId: string;
          songCount: number;
          playlistName: string;
          description: string;
          degraded?: boolean;
          source: "generated" | "stored";
      }
    | { state: "failed"; date: string; message: string; code: IAiDailyErrorCode };

export interface IAiDailySearchPlan {
    keyword: string;
    reason: string;
}

export interface IAiDailyRecord {
    date: string;
    sheetId: string;
    songCount: number;
    playlistName: string;
    description: string;
    searches: IAiDailySearchPlan[];
    degraded?: boolean;
    ts: number;
}

export const aiDailyStatusAtom = atom<IAiDailyStatus>({ state: "idle" });

function setStatus(status: IAiDailyStatus) {
    getDefaultStore().set(aiDailyStatusAtom, status);
}

/** 本地日期 YYYY-MM-DD (拒绝 UTC，按手机时区) */
export function todayStr(date = new Date()): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
}

const WEEK_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export function sheetTitleForDate(date: string) {
    return `AI日推 ${date}`;
}

export function getRecords(): IAiDailyRecord[] {
    const parsed = safeParse<IAiDailyRecord[]>(store.getString(RECORDS_KEY));
    return Array.isArray(parsed) ? parsed.filter(it => !!it?.date) : [];
}

export function getRecordByDate(date: string): IAiDailyRecord | null {
    return getRecords().find(it => it.date === date) ?? null;
}

export function getLatestRecord(): IAiDailyRecord | null {
    return getRecords()[0] ?? null;
}

function saveRecord(record: IAiDailyRecord) {
    const newRecords = [
        record,
        ...getRecords().filter(it => it.date !== record.date),
    ].slice(0, RECORD_LIMIT);
    store.set(RECORDS_KEY, safeStringify(newRecords));
}

function findSheetByTitle(title: string) {
    return MusicSheet.backupSheets().find(it => it.title === title) ?? null;
}

// ---------------------------------------------------------------- output schema

export const AI_DAILY_SCHEMA = {
    type: "object",
    properties: {
        playlistName: { type: "string" },
        description: { type: "string" },
        searches: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    keyword: { type: "string" },
                    reason: { type: "string" },
                },
                required: ["keyword", "reason"],
            },
        },
    },
    required: ["playlistName", "description", "searches"],
};

interface IRawDailyJson {
    playlistName?: string;
    description?: string;
    searches?: Array<{ keyword?: string; reason?: string }>;
}

function buildDailyPrompt(date: string): {
    system: string;
    user: string;
} {
    const weekday = WEEK_NAMES[new Date().getDay()];
    const system = `你是一位资深音乐编辑，为音乐 App 设计每日歌单。
今天是 ${date} 周${weekday}。
只输出"搜索关键词"，不要输出歌名或歌手名。
要求：
1. searches 输出 5-6 个关键词，每个关键词 2-12 个字，风格要差异化（例如：华语流行、深夜民谣、City Pop、轻电子）
2. reason 是不超过 20 字的推荐理由
3. playlistName 不超过 8 个字，description 不超过 60 个字
4. 不推荐用户回避的歌手或关键词`;
    const profile = buildProfileSummary();
    const user = profile
        ? `${profile}。\n请根据以上偏好生成今天的歌单。`
        : "用户暂无偏好数据，请按当日氛围推荐大众向风格。\n请生成今天的歌单。";
    return { system, user };
}

function normalizeSearches(raw: IRawDailyJson): IAiDailySearchPlan[] {
    const seen = new Set<string>();
    const plans: IAiDailySearchPlan[] = [];
    (raw.searches ?? []).forEach(it => {
        const keyword = (it?.keyword ?? "").trim();
        if (!keyword || seen.has(keyword)) {
            return;
        }
        seen.add(keyword);
        plans.push({ keyword, reason: (it?.reason ?? "").trim() });
    });
    plans.splice(MAX_KEYWORDS);

    // 点踩关键词过滤；过滤后不足 4 个则不过滤
    const now = Date.now();
    const dislikedKeywords = getFeedbackEntries()
        .filter(
            it =>
                it.action === "dislike" &&
                !!it.keyword &&
                now - it.ts <= DISLIKE_WINDOW_MS,
        )
        .map(it => it.keyword!.trim())
        .filter(Boolean);
    if (dislikedKeywords.length) {
        const filtered = plans.filter(
            plan =>
                !dislikedKeywords.some(
                    disliked =>
                        plan.keyword.includes(disliked) ||
                        disliked.includes(plan.keyword),
                ),
        );
        if (filtered.length >= MIN_KEYWORDS) {
            return filtered;
        }
    }
    return plans;
}

// ---------------------------------------------------------------- search chain

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("timeout")),
            Math.max(ms, 1),
        );
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
) {
    let cursor = 0;
    const runners = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (true) {
                const index = cursor++;
                if (index >= items.length) {
                    return;
                }
                await worker(items[index]);
            }
        },
    );
    await Promise.all(runners);
}

interface ISearchHit {
    item: IMusic.IMusicItem;
    plan: IAiDailySearchPlan;
}

interface ISearchContext {
    date: string;
    deadline: number;
    usedKeys: Set<string>;
    usedSigs: Set<string>;
    artistCounts: Map<string, number>;
    dislikedArtists: Set<string>;
    knownSignatures: Set<string>;
    hits: ISearchHit[];
}

const ARTIST_SPLIT_RE = /[/、,;&]/;

function normalizeName(value?: string | null) {
    return (value ?? "").toLowerCase().replace(/\s+/g, "");
}

function artistNamesOf(item: IMusic.IMusicItem): string[] {
    return (item.artist ?? "")
        .split(ARTIST_SPLIT_RE)
        .map(it => it.trim())
        .filter(Boolean);
}

function signatureOf(item: IMusic.IMusicItem) {
    const title = normalizeName(item.title);
    const artist = normalizeName(item.artist);
    return title && artist ? `${title}|${artist}` : "";
}

/** 统一候选过滤: 拉黑歌手 / 已收藏或已播放 / 本批重复 / 单歌手配额 / 关键词同名烂歌 */
function shouldSkipCandidate(
    item: IMusic.IMusicItem,
    ctx: ISearchContext,
    literalSearchTerm?: string,
) {
    const names = artistNamesOf(item);
    if (!names.length) {
        return true;
    }
    const normalizedNames = names.map(normalizeName);
    if (normalizedNames.some(name => ctx.dislikedArtists.has(name))) {
        return true;
    }
    const signature = signatureOf(item);
    if (
        !signature ||
        ctx.knownSignatures.has(signature) ||
        ctx.usedSigs.has(signature)
    ) {
        return true;
    }
    if (
        literalSearchTerm &&
        normalizeName(item.title) === normalizeName(literalSearchTerm)
    ) {
        return true;
    }
    const artistCount = normalizedNames.reduce(
        (max, name) => Math.max(max, ctx.artistCounts.get(name) ?? 0),
        0,
    );
    return artistCount >= MAX_PER_ARTIST;
}

/** 先占位再验源 (并发防重), 验源通过后登记歌手计数 */
async function tryCollectCandidate(
    candidate: IMusic.IMusicItem,
    plugin: Plugin,
    ctx: ISearchContext,
): Promise<boolean> {
    const uniqueKey = getMediaUniqueKey(candidate);
    if (ctx.usedKeys.has(uniqueKey)) {
        return false;
    }
    ctx.usedKeys.add(uniqueKey);
    const rest = ctx.deadline - Date.now();
    if (rest <= 0) {
        ctx.usedKeys.delete(uniqueKey);
        return false;
    }
    const source = await withTimeout(
        plugin.methods.getMediaSource(candidate, "standard"),
        Math.min(SOURCE_TIMEOUT, rest),
    ).catch(() => null);
    if (!source?.url || !/^https?:\/\/|^file:\/\//i.test(source.url)) {
        ctx.usedKeys.delete(uniqueKey);
        return false;
    }
    const signature = signatureOf(candidate);
    if (signature) {
        ctx.usedSigs.add(signature);
    }
    artistNamesOf(candidate).forEach(name => {
        const key = normalizeName(name);
        ctx.artistCounts.set(key, (ctx.artistCounts.get(key) ?? 0) + 1);
    });
    return true;
}

/** 口味锚定: 搜常听歌手的未听曲目 */
async function searchSeedArtist(
    artist: string,
    plugins: Plugin[],
    ctx: ISearchContext,
): Promise<void> {
    const seedKey = normalizeName(artist);
    for (const plugin of plugins) {
        if (
            ctx.hits.length >= MAX_HITS_TOTAL ||
            (ctx.artistCounts.get(seedKey) ?? 0) >= SEED_HITS_PER_ARTIST
        ) {
            return;
        }
        const remaining = ctx.deadline - Date.now();
        if (remaining <= 0) {
            return;
        }
        const result = await withTimeout(
            plugin.methods.search(artist, 1, "music"),
            Math.min(SEARCH_TIMEOUT, remaining),
        ).catch(() => null);
        // 搜索结果声明为基类类型，实际为完整音乐对象
        const candidates = (
            (result?.data ?? []) as unknown as IMusic.IMusicItem[]
        ).slice(0, SEED_CANDIDATES);
        for (const candidate of candidates) {
            if (
                ctx.hits.length >= MAX_HITS_TOTAL ||
                (ctx.artistCounts.get(seedKey) ?? 0) >= SEED_HITS_PER_ARTIST
            ) {
                return;
            }
            const names = artistNamesOf(candidate).map(normalizeName);
            if (!names.includes(seedKey)) {
                continue;
            }
            if (shouldSkipCandidate(candidate, ctx)) {
                continue;
            }
            if (!(await tryCollectCandidate(candidate, plugin, ctx))) {
                continue;
            }
            const reason = `常听 · ${artist}`;
            const tagged: IMusic.IMusicItem = {
                ...candidate,
                aiDailyDate: ctx.date,
                aiDailyReason: reason,
            };
            ctx.hits.push({ item: tagged, plan: { keyword: artist, reason } });
        }
    }
}

/** AI 探索位: 关键词搜真实歌曲, 数量受限 */
async function searchExplorationKeyword(
    plan: IAiDailySearchPlan,
    plugins: Plugin[],
    ctx: ISearchContext,
    maxHitsPerKeyword: number,
): Promise<void> {
    let keywordHits = 0;
    const seenArtists = new Set<string>();

    for (const plugin of plugins) {
        if (
            keywordHits >= maxHitsPerKeyword ||
            ctx.hits.length >= MAX_HITS_TOTAL
        ) {
            return;
        }
        const remaining = ctx.deadline - Date.now();
        if (remaining <= 0) {
            return;
        }
        const result = await withTimeout(
            plugin.methods.search(plan.keyword, 1, "music"),
            Math.min(SEARCH_TIMEOUT, remaining),
        ).catch(() => null);
        const candidates = (
            (result?.data ?? []) as unknown as IMusic.IMusicItem[]
        ).slice(0, SEARCH_PER_KEYWORD);
        for (const candidate of candidates) {
            if (
                keywordHits >= maxHitsPerKeyword ||
                ctx.hits.length >= MAX_HITS_TOTAL
            ) {
                return;
            }
            const artist = (candidate.artist ?? "").trim();
            if (artist && seenArtists.has(artist)) {
                continue;
            }
            if (shouldSkipCandidate(candidate, ctx, plan.keyword)) {
                continue;
            }
            if (!(await tryCollectCandidate(candidate, plugin, ctx))) {
                continue;
            }
            if (artist) {
                seenArtists.add(artist);
            }
            keywordHits += 1;
            const tagged: IMusic.IMusicItem = {
                ...candidate,
                aiDailyDate: ctx.date,
                aiDailyKeyword: plan.keyword,
                aiDailyReason: plan.reason,
            };
            ctx.hits.push({ item: tagged, plan });
        }
    }
}

// ---------------------------------------------------------------- pipeline

let running = false;

export function isAiDailyRunning() {
    return running;
}

async function fail(
    date: string,
    code: IAiDailyErrorCode,
    message: string,
) {
    setStatus({ state: "failed", date, message, code });
}

const ERROR_MESSAGES: Record<IAiDailyErrorCode, string> = {
    NOT_READY: "数据还没准备好，请稍后再试",
    OFFLINE: "当前无网络，恢复后再试",
    NO_PLUGIN: "没有可用的音源插件，请先安装并启用插件",
    MODEL_UNAVAILABLE: "本地 AI 模型不可用",
    INVALID_OUTPUT: "AI 输出格式异常，请重试",
    SEARCH_EMPTY: "没有搜到足够的可用歌曲，请重试",
    SAVE_FAILED: "保存歌单失败，请重试",
    UNKNOWN: "生成失败，请重试",
};

async function runPipeline(date: string): Promise<void> {
    if (running) {
        return;
    }
    running = true;
    try {
        await runPipelineInner(date);
    } catch (e: any) {
        await fail(
            date,
            "UNKNOWN",
            `${ERROR_MESSAGES.UNKNOWN}${e?.message ? `（${e.message}）` : ""}`,
        );
    } finally {
        running = false;
    }
}

async function runPipelineInner(date: string): Promise<void> {
    // 1. 环境检查
    if (MusicSheet.backupSheets().length === 0) {
        await fail(date, "NOT_READY", ERROR_MESSAGES.NOT_READY);
        return;
    }
    if (Network.isOffline) {
        await fail(date, "OFFLINE", ERROR_MESSAGES.OFFLINE);
        return;
    }
    const plugins = pluginManager.getSortedSearchablePlugins("music");
    if (!plugins.length) {
        await fail(date, "NO_PLUGIN", ERROR_MESSAGES.NO_PLUGIN);
        return;
    }
    const seeds = buildProfileSeeds();

    // 2. 当日残骸恢复
    const title = sheetTitleForDate(date);
    const existingSheet = findSheetByTitle(title);
    let reuseSheetId: string | null = null;
    if (existingSheet) {
        const existingList = MusicSheet.getSortedMusicListBySheetId(
            existingSheet.id,
        ).musicList;
        if (existingList.length > 0) {
            const record: IAiDailyRecord = {
                date,
                sheetId: existingSheet.id,
                songCount: existingList.length,
                playlistName: title,
                description: "",
                searches: [],
                ts: Date.now(),
            };
            saveRecord(record);
            store.set(LAST_GENERATED_KEY, date);
            setStatus({
                state: "done",
                date,
                sheetId: existingSheet.id,
                songCount: existingList.length,
                playlistName: title,
                description: "",
                source: "stored",
            });
            return;
        }
        reuseSheetId = existingSheet.id;
    }

    // 3. 模型初始化
    setStatus({ state: "generating", stage: "model-init" });
    const unsubscribe = subscribeLlamaInitProgress(progress => {
        setStatus({
            state: "generating",
            stage: "model-init",
            progress: Math.max(0, Math.min(1, progress)),
        });
    });
    let ready = false;
    try {
        ready = await initLocalLlama();
    } finally {
        unsubscribe();
    }
    if (!ready) {
        const reason = getLastInitError();
        await fail(
            date,
            "MODEL_UNAVAILABLE",
            `${ERROR_MESSAGES.MODEL_UNAVAILABLE}${reason ? `（${reason}）` : ""}`,
        );
        return;
    }

    // 4. 生成关键词
    setStatus({ state: "generating", stage: "thinking" });
    const { system, user } = buildDailyPrompt(date);
    const { fullText } = await localCompletion(
        [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        { schema: AI_DAILY_SCHEMA, maxTokens: 700, temperature: 0.8 },
    );
    const parsed = parseFirstJsonObject<IRawDailyJson>(fullText);
    if (
        !parsed ||
        typeof parsed.playlistName !== "string" ||
        typeof parsed.description !== "string" ||
        !Array.isArray(parsed.searches)
    ) {
        await fail(date, "INVALID_OUTPUT", ERROR_MESSAGES.INVALID_OUTPUT);
        return;
    }
    const searches = normalizeSearches(parsed);
    if (!searches.length && !seeds.likedArtists.length) {
        await fail(date, "INVALID_OUTPUT", ERROR_MESSAGES.INVALID_OUTPUT);
        return;
    }

    // 5. 生成候选: 常听歌手主体 + AI 关键词探索位
    const seedArtists = seeds.likedArtists.slice(0, MAX_SEED_ARTISTS);
    const isColdStart = seedArtists.length === 0;
    const explorationPlans = searches.slice(
        0,
        isColdStart ? COLD_START_KEYWORDS : EXPLORATION_KEYWORDS,
    );
    const totalSteps = seedArtists.length + explorationPlans.length;
    const ctx: ISearchContext = {
        date,
        deadline: Date.now() + TOTAL_BUDGET,
        usedKeys: new Set<string>(),
        usedSigs: new Set<string>(),
        artistCounts: new Map<string, number>(),
        dislikedArtists: new Set(seeds.dislikedArtists.map(normalizeName)),
        knownSignatures: seeds.knownSignatures,
        hits: [],
    };
    let completed = 0;
    const reportStep = () => {
        completed += 1;
        setStatus({
            state: "generating",
            stage: "searching",
            progress: totalSteps ? completed / totalSteps : 0,
            detail: `${completed}/${totalSteps}`,
        });
    };
    setStatus({
        state: "generating",
        stage: "searching",
        progress: 0,
        detail: `0/${totalSteps}`,
    });
    if (seedArtists.length) {
        await runWithConcurrency(seedArtists, SEED_CONCURRENCY, async artist => {
            await searchSeedArtist(artist, plugins, ctx).catch(() => {});
            reportStep();
        });
    }
    if (explorationPlans.length) {
        await runWithConcurrency(explorationPlans, 1, async plan => {
            await searchExplorationKeyword(
                plan,
                plugins,
                ctx,
                isColdStart
                    ? MAX_EXPLORATION_HITS_COLD_START
                    : MAX_EXPLORATION_HITS_PER_KEYWORD,
            ).catch(() => {});
            reportStep();
        });
    }
    const hits = ctx.hits;

    if (hits.length < MIN_HITS) {
        await fail(date, "SEARCH_EMPTY", ERROR_MESSAGES.SEARCH_EMPTY);
        return;
    }

    // 6. 保存歌单
    setStatus({ state: "generating", stage: "saving" });
    let sheetId = reuseSheetId;
    let created = false;
    if (!sheetId) {
        sheetId = await MusicSheet.addSheet(title);
        created = true;
    }
    try {
        await MusicSheet.addMusic(
            sheetId,
            hits.map(hit => hit.item),
        );
    } catch (e: any) {
        if (created) {
            await MusicSheet.removeSheet(sheetId).catch(() => {});
        }
        await fail(
            date,
            "SAVE_FAILED",
            `${ERROR_MESSAGES.SAVE_FAILED}${e?.message ? `（${e.message}）` : ""}`,
        );
        return;
    }
    const songCount =
        MusicSheet.getSortedMusicListBySheetId(sheetId).musicList.length;
    if (songCount === 0) {
        if (created) {
            await MusicSheet.removeSheet(sheetId).catch(() => {});
        }
        await fail(date, "SAVE_FAILED", ERROR_MESSAGES.SAVE_FAILED);
        return;
    }

    // 7. 落库
    const playlistName = parsed.playlistName.trim() || title;
    const description = parsed.description.trim();
    const degraded = hits.length < DEGRADED_HITS;
    saveRecord({
        date,
        sheetId,
        songCount,
        playlistName,
        description,
        searches,
        degraded,
        ts: Date.now(),
    });
    store.set(LAST_GENERATED_KEY, date);
    setStatus({
        state: "done",
        date,
        sheetId,
        songCount,
        playlistName,
        description,
        degraded,
        source: "generated",
    });
}

// ---------------------------------------------------------------- entry points

/** 从 MMKV 恢复状态 (app 启动 / 回到前台时调用) */
export function hydrate() {
    const status = getDefaultStore().get(aiDailyStatusAtom);
    if (status.state === "generating" || running) {
        return;
    }
    const date = todayStr();
    const record = getRecordByDate(date);
    if (record) {
        const sheetExists = MusicSheet.backupSheets().some(
            it => it.id === record.sheetId,
        );
        if (sheetExists) {
            setStatus({
                state: "done",
                date,
                sheetId: record.sheetId,
                songCount: record.songCount,
                playlistName: record.playlistName,
                description: record.description,
                degraded: record.degraded,
                source: "stored",
            });
            return;
        }
        // 用户删了今天的歌单 → 允许重新生成
        if (store.getString(LAST_GENERATED_KEY) === date) {
            store.delete(LAST_GENERATED_KEY);
        }
    }
    // 保留今天的失败态 (避免回到前台被刷成 idle 丢失提示)
    if (status.state === "failed" && status.date === date) {
        return;
    }
    setStatus({ state: "idle" });
}

/** 每天首次打开自动生成 (autoAttemptDate 防同一天自动重复) */
export async function autoGenerateIfNeeded(): Promise<void> {
    const date = todayStr();
    const status = getDefaultStore().get(aiDailyStatusAtom);
    if (running || status.state === "generating") {
        return;
    }
    if (status.state === "done" && status.date === date) {
        return;
    }
    if (store.getString(AUTO_ATTEMPT_KEY) === date) {
        return;
    }
    store.set(AUTO_ATTEMPT_KEY, date);
    await runPipeline(date);
}

/** 手动重试 (失败重试 / 卡片点击生成) */
export async function retry(): Promise<void> {
    if (running) {
        return;
    }
    const date = todayStr();
    hydrate();
    const status = getDefaultStore().get(aiDailyStatusAtom);
    if (status.state === "done" && status.date === date) {
        return;
    }
    store.set(AUTO_ATTEMPT_KEY, date);
    await runPipeline(date);
}
