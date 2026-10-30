import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import SongCard from "./songCard";
import type { AiSource } from "../aiService";

export interface IChatMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    songs?: IMusic.IMusicItem[];
    /** AI 回复来源 (调试可见) */
    source?: AiSource;
    /** 生成中 (显示加载状态) */
    pending?: boolean;
    /** 当前阶段文案: 模型加载进度 / 思考中 */
    status?: string;
    /** 生成失败, 可重试 */
    error?: boolean;
    retryInput?: string;
}

const SOURCE_LABELS: Record<AiSource, string> = {
    cloud: "云端 AI",
    local: "本地 AI",
    http: "电脑 AI",
    mock: "离线兜底",
};

function songSignature(song: IMusic.IMusicItem) {
    const title = (song.title ?? "").toLowerCase().replace(/\s+/g, "");
    const artist = (song.artist ?? "").toLowerCase().replace(/\s+/g, "");
    return title ? `${title}|${artist}` : "";
}

/** 聊天气泡: 用户靠右(主色), AI 靠左(卡片色), AI 消息下方可挂歌单卡片 */
export default function MessageBubble(props: {
    message: IChatMessage;
    onRetry?: (input: string) => void;
}) {
    const { message, onRetry } = props;
    const colors = useColors();
    const isUser = message.role === "user";
    const showLoading = !isUser && message.pending && !message.text;

    const songs = useMemo(() => {
        const seen = new Set<string>();
        return (message.songs ?? []).filter(song => {
            const signature = songSignature(song);
            if (!signature || seen.has(signature)) {
                return false;
            }
            seen.add(signature);
            return true;
        });
    }, [message.songs]);

    return (
        <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
            <View
                style={[
                    styles.bubble,
                    isUser
                        ? {
                            backgroundColor: colors.primary,
                            borderBottomRightRadius: rpx(8),
                        }
                        : {
                            backgroundColor: colors.placeholder,
                            borderBottomLeftRadius: rpx(8),
                        },
                ]}>
                {!isUser && message.source ? (
                    <ThemeText
                        fontSize="tag"
                        fontColor="textSecondary"
                        style={styles.sourceTag}>
                        {SOURCE_LABELS[message.source]}
                    </ThemeText>
                ) : null}
                {showLoading ? (
                    <View style={styles.statusRow}>
                        <ActivityIndicator
                            size="small"
                            color={colors.textHighlight ?? colors.primary}
                        />
                        <ThemeText
                            fontSize="content"
                            fontColor="textSecondary"
                            style={styles.statusText}>
                            {message.status ?? "思考中…"}
                        </ThemeText>
                    </View>
                ) : (
                    <>
                        <ThemeText
                            color={isUser ? "#ffffff" : colors.text}
                            fontSize="content">
                            {message.text}
                        </ThemeText>
                        {!isUser && message.pending && message.text ? (
                            <View style={[styles.statusRow, styles.statusInline]}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.textHighlight ?? colors.primary}
                                />
                                <ThemeText
                                    fontSize="tag"
                                    fontColor="textSecondary"
                                    style={styles.statusText}>
                                    {message.status ?? "正在生成歌曲…"}
                                </ThemeText>
                            </View>
                        ) : null}
                        {message.error && message.retryInput ? (
                            <Pressable
                                style={[
                                    styles.retry,
                                    {
                                        borderColor:
                                            colors.textHighlight ?? colors.primary,
                                    },
                                ]}
                                onPress={() => onRetry?.(message.retryInput!)}>
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textHighlight">
                                    重试
                                </ThemeText>
                            </Pressable>
                        ) : null}
                    </>
                )}
            </View>
            {!isUser && songs.length ? (
                <View style={styles.cardWrapper}>
                    <SongCard songs={songs} />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        marginBottom: rpx(24),
        alignItems: "flex-start",
    },
    rowLeft: {
        alignItems: "flex-start",
    },
    rowRight: {
        alignItems: "flex-end",
    },
    bubble: {
        maxWidth: "80%",
        borderRadius: rpx(24),
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    sourceTag: {
        marginBottom: rpx(6),
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    statusText: {
        marginLeft: rpx(12),
    },
    statusInline: {
        marginTop: rpx(10),
    },
    retry: {
        marginTop: rpx(14),
        alignSelf: "flex-start",
        borderWidth: 1,
        borderRadius: rpx(20),
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(6),
    },
    cardWrapper: {
        width: "100%",
        marginTop: rpx(12),
    },
});
