import {
    initLocalLlama,
    localCompletion,
    AI_JSON_SCHEMA,
} from "./llamaService";
import { IAiReply, mockAiReply } from "./mock";

// Phase 4: 电脑端 llama-server (开发调试)
// Phase 5: 手机本地 llama.rn 推理 (默认, 0 流量)
// 三态优先级: 本地模型 > 电脑 HTTP > 本地假数据
const AI_SERVER_URL = "http://192.168.137.1:8080/v1/chat/completions";
const AI_MODEL = "qwen2.5-3b-instruct";

export type AiSource = "local" | "http" | "mock";

const SYSTEM_PROMPT = "你是一个懂音乐的点歌助手。根据用户的心情和需求，先回复一段温暖简短的话（80字以内），再推荐 3 首合适的歌。";

interface IRawSong {
  title: string;
  artist: string;
  album?: string;
  aiComment?: string;
}

interface IRawAiJson {
  text: string;
  songs: IRawSong[];
}

/** 清洗模型输出: 剥 markdown 代码块, 截取首个 JSON 对象 */
function parseAiJson(content: string): IRawAiJson | null {
    let cleaned = content.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        cleaned = fence[1].trim();
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
        return null;
    }
    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        return null;
    }
}

function rawToReply(parsed: IRawAiJson, prefix: string): IAiReply {
    return {
        text: parsed.text,
        songs: parsed.songs.map((s, i) => ({
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
}

export interface IAiReplyOptions {
  onToken?: (text: string) => void;
}

/** 手机本地推理 (llama.rn, 流式) */
async function replyFromLocal(
    input: string,
    opts: IAiReplyOptions,
): Promise<IAiReplyResult> {
    const ready = await initLocalLlama();
    if (!ready) {
        throw new Error("local llama not available");
    }
    const { fullText } = await localCompletion(
        [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: input },
        ],
        {
            maxTokens: 512,
            onToken: opts.onToken,
        },
    );
    const parsed = parseAiJson(fullText);
    if (parsed?.text && Array.isArray(parsed.songs)) {
        return { reply: rawToReply(parsed, "local"), source: "local" };
    }
    return {
        reply: { text: fullText || "抱歉，我走神了，再说一次试试？", songs: [] },
        source: "local",
    };
}

/** 电脑端 llama-server (开发调试用) */
async function replyFromHttp(
    input: string,
): Promise<IAiReplyResult> {
    const resp = await fetch(AI_SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: AI_MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: input },
            ],
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
        return { reply: rawToReply(parsed, "http"), source: "http" };
    }
    return {
        reply: { text: content || "抱歉，我走神了，再说一次试试？", songs: [] },
        source: "http",
    };
}

/**
 * AI 回复入口: 本地 → HTTP → mock 逐级回退
 * onToken 流式回调仅在 local 链路生效 (逐字上屏)
 */
export async function aiReply(
    input: string,
    opts: IAiReplyOptions = {},
): Promise<IAiReplyResult> {
    try {
        return await replyFromLocal(input, opts);
    } catch {
    // 本地不可用, 尝试电脑端
    }
    try {
        return await replyFromHttp(input);
    } catch {
    // 电脑端不可达, 回退本地假数据 (聊天永不中断)
    }
    return { reply: await mockAiReply(input), source: "mock" };
}

export { AI_JSON_SCHEMA };
