// iOS 本地模型下载 (ModelScope 直链, 一次性下载后完全离线)
// 下载 → 大小校验 → SHA-256 校验 → 移动到 Documents, llamaService 自动发现
import RNFS from "react-native-fs";
import { Platform } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { errorLog } from "@/utils/log";

export const IOS_MODEL_NAME = "qwen2.5-3b-music-q4_k_m.gguf";
export const IOS_MODEL_BYTES = 1929902400;
export const IOS_MODEL_SHA256 =
    "2eaaa26e9db9713f80f0add2ba6b2c2e4624b4a8d12381a13c7449ac17343f11";

export const IOS_MODEL_URL =
    "https://modelscope.cn/models/again121212/qwen2.5-3b-music-gguf/resolve/master/qwen2.5-3b-music-q4_k_m.gguf";

export type ModelDownloadStatus =
    | "idle"
    | "downloading"
    | "verifying"
    | "done"
    | "error"
    | "canceled";

export interface IModelDownloadState {
    status: ModelDownloadStatus;
    bytesWritten: number;
    totalBytes: number;
    error?: string;
}

const KEEP_AWAKE_TAG = "model-download";

class ModelDownloader {
    private state: IModelDownloadState = {
        status: "idle",
        bytesWritten: 0,
        totalBytes: IOS_MODEL_BYTES,
    };

    private listeners = new Set<() => void>();
    private jobId: number | null = null;

    getState() {
        return this.state;
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private update(patch: Partial<IModelDownloadState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch {}
        });
    }

    reset() {
        if (this.jobId != null) {
            return;
        }
        this.update({
            status: "idle",
            bytesWritten: 0,
            totalBytes: IOS_MODEL_BYTES,
            error: undefined,
        });
    }

    cancel() {
        if (this.jobId != null) {
            RNFS.stopDownload(this.jobId);
            this.jobId = null;
        }
        this.update({ status: "canceled" });
    }

    private async commitModel(partPath: string): Promise<string | null> {
        const finalPath = `${RNFS.DocumentDirectoryPath}/${IOS_MODEL_NAME}`;
        this.update({
            status: "verifying",
            bytesWritten: IOS_MODEL_BYTES,
            totalBytes: IOS_MODEL_BYTES,
        });
        const info = await RNFS.stat(partPath).catch(() => null);
        if (!info || Number(info.size) !== IOS_MODEL_BYTES) {
            await RNFS.unlink(partPath).catch(() => {});
            return "文件大小校验失败，请重试";
        }
        const hash = await RNFS.hash(partPath, "sha256").catch(() => "");
        if (hash.toLowerCase() !== IOS_MODEL_SHA256) {
            await RNFS.unlink(partPath).catch(() => {});
            return "文件校验失败（SHA-256 不一致），请重试";
        }
        await RNFS.moveFile(partPath, finalPath);
        return null;
    }

    async start() {
        if (Platform.OS !== "ios" || this.jobId != null) {
            return;
        }
        if (!IOS_MODEL_URL) {
            this.update({ status: "error", error: "下载源尚未配置" });
            return;
        }
        const finalPath = `${RNFS.DocumentDirectoryPath}/${IOS_MODEL_NAME}`;
        const partPath = `${finalPath}.part`;
        try {
            if (await RNFS.exists(finalPath)) {
                this.update({
                    status: "done",
                    bytesWritten: IOS_MODEL_BYTES,
                    totalBytes: IOS_MODEL_BYTES,
                });
                return;
            }
            const fsInfo = await RNFS.getFSInfo().catch(() => null);
            if (
                fsInfo &&
                fsInfo.freeSpace < IOS_MODEL_BYTES + 300 * 1024 * 1024
            ) {
                this.update({
                    status: "error",
                    error: "可用存储空间不足（至少需要约 2.2GB）",
                });
                return;
            }
            await RNFS.unlink(partPath).catch(() => {});
            this.update({
                status: "downloading",
                bytesWritten: 0,
                totalBytes: IOS_MODEL_BYTES,
                error: undefined,
            });
            activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
            const job = RNFS.downloadFile({
                fromUrl: IOS_MODEL_URL,
                toFile: partPath,
                progressDivider: 1,
                progress: res => {
                    this.update({
                        bytesWritten: res.bytesWritten,
                        totalBytes:
                            res.contentLength > 0
                                ? res.contentLength
                                : IOS_MODEL_BYTES,
                    });
                },
            });
            this.jobId = job.jobId;
            const result = await job.promise.catch(() => null);
            if (this.jobId == null && this.state.status === "canceled") {
                await RNFS.unlink(partPath).catch(() => {});
                deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
                return;
            }
            this.jobId = null;
            deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
            if (
                !result ||
                result.statusCode < 200 ||
                result.statusCode >= 400
            ) {
                await RNFS.unlink(partPath).catch(() => {});
                this.update({
                    status: "error",
                    error: `下载失败（HTTP ${result?.statusCode ?? "网络错误"}）`,
                });
                return;
            }
            const verifyError = await this.commitModel(partPath);
            if (verifyError) {
                this.update({ status: "error", error: verifyError });
                return;
            }
            this.update({
                status: "done",
                bytesWritten: IOS_MODEL_BYTES,
                totalBytes: IOS_MODEL_BYTES,
            });
        } catch (e: any) {
            errorLog("模型下载失败", e?.message ?? String(e));
            this.jobId = null;
            deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
            await RNFS.unlink(partPath).catch(() => {});
            this.update({ status: "error", error: e?.message ?? "下载失败，请重试" });
        }
    }
}

const downloader = new ModelDownloader();

export function startIosModelDownload() {
    return downloader.start();
}

export default downloader;
