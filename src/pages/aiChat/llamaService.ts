// Phase 5: 手机端本地推理 (llama.rn, 0 流量)
// 模型: Qwen2.5-3B-Instruct Q4_K_M, APK assets 内打包, 首启复制到 filesDir
import { initLlama, LlamaContext } from "llama.rn";
import RNFS from "react-native-fs";
import { Platform } from "react-native";

const MODEL_ASSET = "models/qwen2.5-3b-music-q4_k_m.gguf";
const MODEL_FILENAME = "qwen2.5-3b-music-q4_k_m.gguf";

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
        keywords: {
            type: "array",
            items: { type: "string" },
        },
    },
    required: ["text", "songs", "keywords"],
};

let context: LlamaContext | null = null;
let initPromise: Promise<boolean> | null = null;
let lastInitError: string | null = null;

/** 全局初始化进度订阅 (日推卡片/聊天页都可监听) */
type InitProgressListener = (progress: number) => void;
const initProgressListeners = new Set<InitProgressListener>();

export function subscribeLlamaInitProgress(listener: InitProgressListener) {
    initProgressListeners.add(listener);
    return () => {
        initProgressListeners.delete(listener);
    };
}

function emitInitProgress(progress: number) {
    initProgressListeners.forEach(listener => {
        try {
            listener(progress);
        } catch {}
    });
}

export function getLastInitError() {
    return lastInitError;
}

/**
 * 清理 files 目录里除当前模型外的历史 gguf (改动模型文件名后旧文件会残留数 GB)
 * 清理前后清单写入外部目录 model_cleanup.json, 便于 adb 排查
 */
async function cleanupLegacyModels() {
    // iOS 模型由用户手动导入, 不能按文件名清理 (可能被换成任意 gguf)
    if (Platform.OS !== "android") {
        return;
    }
    try {
        const listModels = async () =>
            (await RNFS.readDir(RNFS.DocumentDirectoryPath))
                .filter(
                    it =>
                        it.isFile() &&
                        it.name.toLowerCase().endsWith(".gguf"),
                )
                .map(it => ({ name: it.name, size: it.size }));
        const before = await listModels();
        const stale = before.filter(it => it.name !== MODEL_FILENAME);
        const deleted: Array<{ name: string; size?: number }> = [];
        for (const item of stale) {
            try {
                await RNFS.unlink(
                    `${RNFS.DocumentDirectoryPath}/${item.name}`,
                );
                deleted.push(item);
            } catch {}
        }
        await RNFS.writeFile(
            `${RNFS.ExternalDirectoryPath}/model_cleanup.json`,
            JSON.stringify({
                ts: Date.now(),
                before,
                deleted,
                after: await listModels(),
            }),
            "utf8",
        ).catch(() => {});
    } catch {}
}

/** iOS: 模型不内置, 扫描沙盒 Documents 里用户导入的 gguf */
async function discoverIosModelPath(): Promise<string | null> {
    try {
        const entries = await RNFS.readDir(RNFS.DocumentDirectoryPath);
        const exact = entries.find(
            it => it.isFile() && it.name === MODEL_FILENAME,
        );
        if (exact) {
            return exact.path;
        }
        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
                return entry.path;
            }
            if (entry.isDirectory()) {
                try {
                    const hit = (await RNFS.readDir(entry.path)).find(
                        it =>
                            it.isFile() &&
                            it.name.toLowerCase().endsWith(".gguf"),
                    );
                    if (hit) {
                        return hit.path;
                    }
                } catch {}
            }
        }
    } catch {}
    return null;
}

/** 设置页展示用: iOS 返回已导入模型路径 (Android 返回 null, 避免触发内置模型复制) */
export async function probeIosModel(): Promise<string | null> {
    if (Platform.OS !== "ios") {
        return null;
    }
    return discoverIosModelPath();
}

async function getModelFilePath(): Promise<string | null> {
    if (Platform.OS === "ios") {
        return discoverIosModelPath();
    }
    await cleanupLegacyModels();
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
            try {
                const modelPath = await getModelFilePath();
                if (!modelPath) {
                    lastInitError =
                        Platform.OS === "ios"
                            ? "未检测到本地模型：请用「文件」App 把 .gguf 放到 我的iPhone → MusicFree"
                            : "模型文件缺失";
                    return false;
                }
                context = await initLlama(
                    {
                        model: `file://${modelPath}`,
                        n_ctx: 4096,
                        n_threads: 8,
                    },
                    progress => {
                        emitInitProgress(progress);
                        onProgress?.(progress);
                    },
                );
                lastInitError = null;
                return true;
            } catch (e: any) {
                lastInitError = e?.message ?? String(e);
                throw e;
            }
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

/**
 * llama context 是单例: 所有 completion 串行进 FIFO 队列,
 * 避免聊天与日推并发写 KV cache 导致上下文错乱/死锁
 */
let llamaChain: Promise<void> = Promise.resolve();
let llamaQueueCount = 0;

export function runInLlamaQueue<T>(task: () => Promise<T>): Promise<T> {
    llamaQueueCount += 1;
    const result = llamaChain.then(task, task);
    llamaChain = result.then(
        () => {
            llamaQueueCount -= 1;
        },
        () => {
            llamaQueueCount -= 1;
        },
    );
    return result;
}

export function getLlamaQueueCount() {
    return llamaQueueCount;
}

export interface ILocalCompletionResult {
  fullText: string;
}

export interface ILocalCompletionOptions {
    maxTokens?: number;
    temperature?: number;
    /** 自定义输出 schema (语法约束), 缺省为聊天用的 AI_JSON_SCHEMA */
    schema?: object;
    onToken?: (text: string) => void;
}

/**
 * 本地流式补全: onToken 每生成一个 token 回调一次
 * 返回完整文本 (json_schema 约束下必为合法 JSON)
 */
export async function localCompletion(
    messages: Array<{ role: string; content: string }>,
    options: ILocalCompletionOptions = {},
): Promise<ILocalCompletionResult> {
    const {
        maxTokens = 512,
        temperature = 0.7,
        schema = AI_JSON_SCHEMA,
        onToken,
    } = options;

    return runInLlamaQueue(async () => {
        if (!context) {
            throw new Error("llama context not initialized");
        }
        let fullText = "";

        await context.completion(
            {
                messages,
                n_predict: maxTokens,
                temperature,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        schema,
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
    });
}
