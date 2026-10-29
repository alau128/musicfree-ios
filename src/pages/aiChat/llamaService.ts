// Phase 5: 手机端本地推理 (llama.rn, 0 流量)
// 模型: Qwen2.5-3B-Instruct Q4_K_M, APK assets 内打包, 首启复制到 filesDir
import { initLlama, LlamaContext } from "llama.rn";
import RNFS from "react-native-fs";

const MODEL_ASSET = "models/qwen2.5-3b-instruct-q4_k_m.gguf";
const MODEL_FILENAME = "qwen2.5-3b-instruct-q4_k_m.gguf";

// 强制模型输出该 JSON 结构 (llama.rn 原生 schema → grammar 约束)
export const AI_JSON_SCHEMA = {
    type: "object",
    properties: {
        text: { type: "string" },
        songs: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    artist: { type: "string" },
                    album: { type: "string" },
                    aiComment: { type: "string" },
                },
                required: ["title", "artist"],
            },
        },
    },
    required: ["text", "songs"],
};

let context: LlamaContext | null = null;
let initPromise: Promise<boolean> | null = null;

async function getModelFilePath(): Promise<string | null> {
    const dest = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;
    if (await RNFS.exists(dest)) {
        return dest;
    }
    const existsInAssets = await RNFS.existsAssets(MODEL_ASSET);
    if (!existsInAssets) {
        return null;
    }
    // 首启: assets → filesDir (本地 IO, 0 网络流量)
    await RNFS.copyFileAssets(MODEL_ASSET, dest);
    return dest;
}

/** 初始化本地模型 (幂等, 带进度回调) */
export function initLocalLlama(
    onProgress?: (progress: number) => void,
): Promise<boolean> {
    if (context) {
        return Promise.resolve(true);
    }
    if (!initPromise) {
        initPromise = (async () => {
            const modelPath = await getModelFilePath();
            if (!modelPath) {
                return false;
            }
            context = await initLlama(
                {
                    model: `file://${modelPath}`,
                    n_ctx: 4096,
                    n_threads: 8,
                },
                onProgress,
            );
            return true;
        })().catch(() => {
            initPromise = null;
            return false;
        });
    }
    return initPromise;
}

export function isLocalLlamaReady() {
    return context !== null;
}

export async function releaseLocalLlama() {
    if (context) {
        await context.release().catch(() => {});
        context = null;
    }
    initPromise = null;
}

export interface ILocalCompletionResult {
  fullText: string;
}

/**
 * 本地流式补全: onToken 每生成一个 token 回调一次
 * 返回完整文本 (json_schema 约束下必为合法 JSON)
 */
export async function localCompletion(
    messages: Array<{ role: string; content: string }>,
    options: {
    maxTokens?: number;
    onToken?: (text: string) => void;
  } = {},
): Promise<ILocalCompletionResult> {
    if (!context) {
        throw new Error("llama context not initialized");
    }
    const { maxTokens = 512, onToken } = options;
    let fullText = "";

    await context.completion(
        {
            messages,
            n_predict: maxTokens,
            temperature: 0.7,
            response_format: {
                type: "json_schema",
                json_schema: {
                    schema: AI_JSON_SCHEMA,
                },
            },
        },
        data => {
            if (data.token) {
                fullText += data.token;
                onToken?.(data.token);
            }
        },
    );

    return { fullText };
}
