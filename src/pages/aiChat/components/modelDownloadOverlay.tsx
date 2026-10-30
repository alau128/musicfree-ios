import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useAtomValue } from "jotai";
import bootstrapAtom from "@/entry/bootstrap/bootstrap.atom";
import ThemeText from "@/components/base/themeText";
import Toast from "@/utils/toast";
import Network from "@/utils/network";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { probeIosModel } from "../llamaService";
import downloader, {
    IOS_MODEL_BYTES,
    IModelDownloadState,
} from "../modelDownload";

const MODEL_STORE = getOrCreateMMKV("ai.Model");
const PROMPT_KEY = "modelPromptShown";

function formatBytes(bytes: number) {
    if (!bytes) {
        return "0 MB";
    }
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/** iOS 首启的本地模型下载窗 (Android 内置模型, 不展示) */
export default function ModelDownloadOverlay() {
    const bootstrap = useAtomValue(bootstrapAtom);
    const colors = useColors();
    const [state, setState] = useState<IModelDownloadState>(
        downloader.getState(),
    );
    const [promptOpen, setPromptOpen] = useState(false);

    useEffect(
        () => downloader.subscribe(() => setState(downloader.getState())),
        [],
    );

    useEffect(() => {
        if (Platform.OS !== "ios" || bootstrap.state !== "Done") {
            return;
        }
        if (MODEL_STORE.getBoolean(PROMPT_KEY)) {
            return;
        }
        let cancelled = false;
        probeIosModel()
            .then(path => {
                if (!cancelled && !path) {
                    setPromptOpen(true);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPromptOpen(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [bootstrap.state]);

    useEffect(() => {
        if (state.status === "done") {
            Toast.success("本地模型已就绪，AI 功能可用");
            setPromptOpen(false);
        }
    }, [state.status]);

    if (Platform.OS !== "ios") {
        return null;
    }

    const downloading =
        state.status === "downloading" || state.status === "verifying";
    const showError = state.status === "error";
    const showPrompt = promptOpen && !downloading && !showError;

    if (!showPrompt && !downloading && !showError) {
        return null;
    }

    const percent =
        state.totalBytes > 0
            ? Math.min(
                100,
                Math.floor((state.bytesWritten / state.totalBytes) * 100),
            )
            : 0;

    const closePrompt = () => {
        MODEL_STORE.set(PROMPT_KEY, true);
        setPromptOpen(false);
    };

    const beginDownload = () => {
        MODEL_STORE.set(PROMPT_KEY, true);
        setPromptOpen(false);
        downloader.start().catch(() => {});
    };

    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={() => {
                if (showPrompt) {
                    closePrompt();
                }
            }}>
            <View style={styles.mask}>
                <View
                    style={[
                        styles.card,
                        {
                            backgroundColor:
                                colors.pageBackground ?? colors.background,
                        },
                    ]}>
                    {showPrompt ? (
                        <>
                            <ThemeText fontSize="subTitle" fontWeight="bold">
                                下载本地 AI 模型
                            </ThemeText>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.hint}>
                                本地聊天与日推需要 Qwen2.5-3B
                                模型（约 1.9GB，一次性下载，之后完全离线，0
                                流量）。建议在 Wi-Fi
                                下下载，下载期间请保持 App 在前台。
                            </ThemeText>
                            {Network.isCellular ? (
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textHighlight"
                                    style={styles.warn}>
                                    当前为移动网络，将消耗约 1.9GB 流量。
                                </ThemeText>
                            ) : null}
                            <ThemeText
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.hint}>
                                也可跳过下载，用「文件」App 把 .gguf 放入
                                我的iPhone → MusicFree 手动导入。
                            </ThemeText>
                            <View style={styles.actions}>
                                <Pressable
                                    style={styles.button}
                                    onPress={closePrompt}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textSecondary">
                                        以后再说
                                    </ThemeText>
                                </Pressable>
                                <Pressable
                                    style={styles.button}
                                    onPress={beginDownload}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textHighlight">
                                        立即下载
                                    </ThemeText>
                                </Pressable>
                            </View>
                        </>
                    ) : showError ? (
                        <>
                            <ThemeText fontSize="subTitle" fontWeight="bold">
                                模型下载失败
                            </ThemeText>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.hint}>
                                {state.error ?? "网络异常，请重试"}
                            </ThemeText>
                            <View style={styles.actions}>
                                <Pressable
                                    style={styles.button}
                                    onPress={() => downloader.reset()}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textSecondary">
                                        关闭
                                    </ThemeText>
                                </Pressable>
                                <Pressable
                                    style={styles.button}
                                    onPress={() =>
                                        downloader.start().catch(() => {})
                                    }>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textHighlight">
                                        重试
                                    </ThemeText>
                                </Pressable>
                            </View>
                        </>
                    ) : (
                        <>
                            <ThemeText fontSize="subTitle" fontWeight="bold">
                                {state.status === "verifying"
                                    ? "正在校验模型…"
                                    : "正在下载模型…"}
                            </ThemeText>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.hint}>
                                {formatBytes(state.bytesWritten)} /{" "}
                                {formatBytes(state.totalBytes || IOS_MODEL_BYTES)}
                                {state.status === "verifying"
                                    ? ""
                                    : `（${percent}%）`}
                            </ThemeText>
                            <View
                                style={[
                                    styles.progressTrack,
                                    { backgroundColor: colors.placeholder },
                                ]}>
                                <View
                                    style={[
                                        styles.progressBar,
                                        {
                                            backgroundColor:
                                                colors.primary ?? "#4F8EF7",
                                            width: `${percent}%`,
                                        },
                                    ]}
                                />
                            </View>
                            {state.status === "downloading" ? (
                                <View style={styles.actions}>
                                    <Pressable
                                        style={styles.button}
                                        onPress={() => downloader.cancel()}>
                                        <ThemeText
                                            fontSize="content"
                                            fontColor="textSecondary">
                                            取消下载
                                        </ThemeText>
                                    </Pressable>
                                </View>
                            ) : null}
                        </>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    mask: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        justifyContent: "center",
        alignItems: "center",
    },
    card: {
        width: "86%",
        borderRadius: rpx(20),
        padding: rpx(28),
    },
    hint: {
        marginTop: rpx(12),
        lineHeight: rpx(36),
    },
    warn: {
        marginTop: rpx(8),
        lineHeight: rpx(36),
    },
    actions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        marginTop: rpx(20),
    },
    button: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(10),
    },
    progressTrack: {
        height: rpx(8),
        borderRadius: rpx(4),
        marginTop: rpx(20),
        overflow: "hidden",
    },
    progressBar: {
        height: rpx(8),
        borderRadius: rpx(4),
    },
});
