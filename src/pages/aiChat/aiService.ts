import {
    initLocalLlama,
    localCompletion,
    AI_JSON_SCHEMA,
    subscribeLlamaInitProgress,
} from "./llamaService";
import { IAiReply, mockAiReply } from "./mock";
import { resolveRealSongs } from "./songResolve";
import { getCloudConfig } from "./cloudConfig";
import type { ICloudConfig } from "./cloudConfig";
import { extractStreamingText, parseFirstJsonObject } from "@/utils/aiJsonParse";
import { errorLog } from "@/utils/log";
import Network from "@/utils/network";

// 链路优先级: 云端(可选, OpenAI 兼容协议) > 本地 llama.rn > 电脑 HTTP > mock
const AI_SERVER_URL = "http://192.168.137.1:8080/v1/chat/completions";
const AI_MODEL = "qwen2.5-3b-instruct";
const CLOUD_TIMEOUT = 45_000;

export type AiSource = "cloud" | "local" | "http" | "mock";

const SYSTEM_PROMPT =
    "你是一个懂音乐的点歌助手。根据用户的心情和需求，先回复一段温暖简短的话（80字以内），再推荐 3 首合适的歌，并给出 2-3 个用于搜索同类歌曲的关键词（关键词里不要包含歌手名）。";

export interface IChatTurn {
    role: "user" | "assistant";
    content: string;
}

interface IRawSong {
    title: string;
    artist: string;
    album?: string;
    aiComment?: string;
}

interface IRawAiJson {
    text: string;
    songs: IRawSong[];
    keywords?: string[];
}

function parseAiJson(content: string): IRawAiJson | null {
    return parseFirstJsonObject<IRawAiJson>(content);
}

function rawToReply(parsed: IRawAiJson, prefix: string): IAiReply {
    return {
        text: parsed.text,
        songs: (parsed.songs ?? []).map((s, i) => ({
            id: `${prefix}-${Date.now()}-${i}`,
            platform: "MusicAI",
            title: s.title,
            artist: s.artist,
            album: s.album ?? "",
            artwork: "",
            duration: 0,
            aiComment: s.aiComment ?? "",
        })),
    };
}

export interface IAiReplyResult {
    reply: IAiReply;
    source: AiSource;
    keywords?: string[];
}

export interface IAiReplyOptions {
    /** 流式正文回调 (已从 JSON 中提取, 直接上屏) */
    onToken?: (text: string) => void;
    /** 状态回调: 加载进度 / 思考中 / 核验歌曲; undefined 表示结束 */
    onStatus?: (status?: string) => void;
    /** 多轮上下文 (最近 6 轮) */
    history?: IChatTurn[];
}

function buildMessages(
    input: string,
    history?: IChatTurn[],
): Array<{ role: string; content: string }> {
    const turns = (history ?? []).slice(-6);
    return [
        { role: "system", content: SYSTEM_PROMPT },
        ...turns,
        { role: "user", content: input },
    ];
}

/** 把模型歌曲核验成真实音源条目; 离线时跳过 (保留模型建议, 播放时再兜底) */
async function finalizeReply(
    reply: IAiReply,
    source: AiSource,
    keywords: string[] | undefined,
    opts: IAiReplyOptions,
): Promise<IAiReplyResult> {
    let songs = reply.songs;
    if (songs.length && !Network.isOffline) {
        opts.onStatus?.("正在核对真实歌曲…");
        const resolved = await resolveRealSongs(
            songs.map(s => ({
                title: s.title,
                artist: s.artist,
                aiComment: s.aiComment,
            })),
            keywords ?? [],
        ).catch(() => []);
        songs = resolved;
    }
    opts.onStatus?.(undefined);
    return { reply: { ...reply, songs }, source, keywords };
}

/** 手机本地推理 (llama.rn, 流式) */
async function replyFromLocal(
    input: string,
    opts: IAiReplyOptions,
): Promise<IAiReplyResult> {
    const unsubscribe = subscribeLlamaInitProgress(progress => {
        const percent = Math.round(
            Math.max(0, Math.min(1, progress || 0)) * 100,
        );
        opts.onStatus?.(`正在加载本地模型 ${percent}%`);
    });
    let ready = false;
    try {
        ready = await initLocalLlama();
    } finally {
        unsubscribe();
    }
    if (!ready) {
        throw new Error("local llama not available");
    }
    opts.onStatus?.("思考中…");

    let raw = "";
    let emitted = 0;
    const { fullText } = await localCompletion(
        buildMessages(input, opts.history),
        {
            maxTokens: 512,
            onToken: token => {
                raw += token;
                const streamed = extractStreamingText(raw);
                if (streamed.length > emitted) {
                    opts.onToken?.(streamed.slice(emitted));
                    emitted = streamed.length;
                }
            },
        },
    );
    const parsed = parseAiJson(fullText);
    if (parsed?.text && Array.isArray(parsed.songs)) {
        return finalizeReply(
            rawToReply(parsed, "local"),
            "local",
            parsed.keywords,
            opts,
        );
    }
    const fallbackText = extractStreamingText(fullText).trim();
    opts.onStatus?.(undefined);
    return {
        reply: { text: fallbackText, songs: [] },
        source: "local",
    };
}

function cloudEndpoint(baseUrl: string) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/chat/completions")
        ? trimmed
        : `${trimmed}/chat/completions`;
}

/** OpenAI 兼容请求; 部分实现不支持 response_format/私有参数时自动降级重试 */
async function postCloud(
    config: ICloudConfig,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    signal: any,
) {
    const url = cloudEndpoint(config.baseUrl);
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
    };
    const baseBody: any = {
        model: config.model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
    };
    const extended: any = {
        ...baseBody,
        response_format: { type: "json_object" },
    };
    if (config.provider === "zhipu") {
        extended.thinking = { type: "disabled" };
    }
    let resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(extended),
        signal,
    });
    if (!resp.ok && [400, 404, 422].includes(resp.status)) {
        resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(baseBody),
            signal,
        });
    }
    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${body.slice(0, 160)}`);
    }
    return resp.json();
}

/** 云端大模型 (OpenAI 兼容: 智谱/DeepSeek/自定义) */
async function replyFromCloud(
    config: ICloudConfig,
    input: string,
    opts: IAiReplyOptions,
): Promise<IAiReplyResult> {
    opts.onStatus?.("云端思考中…");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUD_TIMEOUT);
    try {
        const messages = buildMessages(input, opts.history);
        messages[0] = {
            role: "system",
            content:
                `${SYSTEM_PROMPT}\n只输出JSON对象，结构：` +
                "{\"text\":\"\",\"songs\":[{\"title\":\"\",\"artist\":\"\",\"album\":\"\",\"aiComment\":\"\"}],\"keywords\":[\"\"]}",
        };
        const data = await postCloud(config, messages, 900, controller.signal);
        const content: string =
            data?.choices?.[0]?.message?.content ?? "";
        const parsed = parseAiJson(content);
        if (parsed?.text && Array.isArray(parsed.songs)) {
            return finalizeReply(
                rawToReply(parsed, "cloud"),
                "cloud",
                parsed.keywords,
                opts,
            );
        }
        errorLog("云端返回无法解析", content.slice(0, 300));
        throw new Error("invalid cloud reply");
    } finally {
        clearTimeout(timer);
    }
}

/** 电脑端 llama-server (开发调试用) */
async function replyFromHttp(
    input: string,
    opts: IAiReplyOptions,
): Promise<IAiReplyResult> {
    const resp = await fetch(AI_SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: AI_MODEL,
            messages: buildMessages(input, opts.history),
            max_tokens: 512,
            temperature: 0.7,
        }),
    });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseAiJson(content);
    if (parsed?.text && Array.isArray(parsed.songs)) {
        return finalizeReply(
            rawToReply(parsed, "http"),
            "http",
            parsed.keywords,
            opts,
        );
    }
    opts.onStatus?.(undefined);
    return {
        reply: { text: extractStreamingText(content).trim(), songs: [] },
        source: "http",
    };
}

/**
 * AI 回复入口: 云端(启用时) → 本地 → HTTP → mock
 * onToken/onStatus 仅在本地链路生效 (逐字上屏 + 加载进度)
 */
export async function aiReply(
    input: string,
    opts: IAiReplyOptions = {},
): Promise<IAiReplyResult> {
    const cloud = getCloudConfig();
    if (
        cloud.enabled &&
        cloud.apiKey &&
        cloud.baseUrl &&
        cloud.model &&
        !Network.isOffline
    ) {
        try {
            return await replyFromCloud(cloud, input, opts);
        } catch (e: any) {
            // 云端失败, 回落本地
            errorLog("云端 AI 失败", e?.message ?? String(e));
            opts.onStatus?.("云端失败，改用本地…");
        }
    }
    try {
        return await replyFromLocal(input, opts);
    } catch {
        // 本地不可用, 尝试电脑端
    }
    try {
        opts.onStatus?.("尝试连接电脑 AI…");
        return await replyFromHttp(input, opts);
    } catch {
        // 电脑端不可达, 回退本地假数据 (聊天永不中断)
    }
    opts.onStatus?.(undefined);
    return { reply: await mockAiReply(input), source: "mock" };
}

/** 云端连通性测试 (设置弹窗用, 抛出的错误直接展示给用户) */
export async function testCloudConnection(config: ICloudConfig) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
        await postCloud(
            config,
            [{ role: "user", content: "ping" }],
            16,
            controller.signal,
        );
    } finally {
        clearTimeout(timer);
    }
}

export { AI_JSON_SCHEMA };
