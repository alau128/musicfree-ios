import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import { aiDailyStatusAtom, retry } from "@/pages/aiDaily/aiDailyService";
import rpx from "@/utils/rpx";
import { useAtomValue } from "jotai";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

const STAGE_TEXT: Record<string, string> = {
    "model-init": "正在准备本地 AI 模型",
    thinking: "AI 正在挑选关键词",
    searching: "正在搜索可播歌曲",
    saving: "正在保存歌单",
};

/** 首页 AI 日推卡片: idle / generating / done / failed 四态 */
export default function AiDailyCard() {
    const status = useAtomValue(aiDailyStatusAtom);
    const colors = useColors();
    const navigate = useNavigate();
    const highlightColor = colors.textHighlight ?? colors.primary;

    function onPress() {
        if (status.state === "done") {
            navigate(ROUTE_PATH.AI_DAILY, { date: status.date });
        } else if (status.state === "idle" || status.state === "failed") {
            retry().catch(() => {});
        }
    }

    let body: React.ReactNode = null;
    if (status.state === "idle") {
        body = (
            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                今日日推还没生成，点我生成
            </ThemeText>
        );
    } else if (status.state === "generating") {
        const progress = status.progress;
        body = (
            <View>
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {STAGE_TEXT[status.stage]}
                    {status.stage === "searching" && status.detail
                        ? ` ${status.detail}`
                        : ""}
                </ThemeText>
                {status.stage === "model-init" ? (
                    <>
                        <View
                            style={[
                                styles.progressTrack,
                                {
                                    backgroundColor:
                                        colors.divider ?? "#88888833",
                                },
                            ]}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        backgroundColor: highlightColor,
                                        width:
                                            progress == null
                                                ? "40%"
                                                : `${Math.round(
                                                    Math.max(
                                                        0,
                                                        Math.min(1, progress),
                                                    ) * 100,
                                                )}%`,
                                    },
                                ]}
                            />
                        </View>
                        {progress == null ? (
                            <ThemeText
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.hint}>
                                首次需复制约 2GB 模型，仅一次
                            </ThemeText>
                        ) : null}
                    </>
                ) : null}
            </View>
        );
    } else if (status.state === "done") {
        body = (
            <View>
                <ThemeText
                    fontSize="content"
                    fontWeight="bold"
                    numberOfLines={1}>
                    {status.playlistName}
                </ThemeText>
                {status.description ? (
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        numberOfLines={2}
                        style={styles.description}>
                        {status.description}
                    </ThemeText>
                ) : null}
                <ThemeText
                    fontSize="tag"
                    fontColor="textSecondary"
                    style={styles.description}>
                    已生成 {status.songCount} 首
                    {status.degraded ? " · 部分关键词未搜到足够歌曲" : ""}
                </ThemeText>
            </View>
        );
    } else if (status.state === "failed") {
        body = (
            <View>
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {status.message}
                </ThemeText>
                <ThemeText
                    fontSize="tag"
                    fontColor="textSecondary"
                    style={styles.description}>
                    点我重试
                </ThemeText>
            </View>
        );
    }

    return (
        <Pressable
            style={[styles.card, { backgroundColor: colors.placeholder }]}
            onPress={onPress}>
            <View style={styles.header}>
                <Icon name="musical-note" size={rpx(32)} color={highlightColor} />
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    style={styles.headerText}>
                    AI 日推
                </ThemeText>
                {status.state === "done" ? (
                    <ThemeText
                        fontSize="tag"
                        fontColor="textSecondary"
                        style={styles.headerTag}>
                        {status.date}
                    </ThemeText>
                ) : null}
                {status.state === "generating" ? (
                    <Icon
                        name="arrow-path"
                        size={rpx(28)}
                        color={colors.textSecondary}
                        style={styles.headerTag}
                    />
                ) : null}
            </View>
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: rpx(24),
        marginBottom: rpx(24),
        borderRadius: rpx(16),
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(20),
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: rpx(10),
    },
    headerText: {
        marginLeft: rpx(12),
    },
    headerTag: {
        marginLeft: "auto",
    },
    description: {
        marginTop: rpx(6),
    },
    hint: {
        marginTop: rpx(6),
    },
    progressTrack: {
        height: rpx(8),
        borderRadius: rpx(4),
        marginTop: rpx(12),
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: rpx(4),
    },
});
