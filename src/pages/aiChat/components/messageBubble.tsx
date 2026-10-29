import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React from "react";
import { StyleSheet, View } from "react-native";
import SongCard from "./songCard";
import type { AiSource } from "../aiService";

export interface IChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  songs?: IMusic.IMusicItem[];
  /** AI 回复来源 (调试可见) */
  source?: AiSource;
}

const SOURCE_LABELS: Record<AiSource, string> = {
    local: "本地 AI",
    http: "电脑 AI",
    mock: "离线兜底",
};

/** 聊天气泡: 用户靠右(主色), AI 靠左(卡片色), AI 消息下方可挂歌单卡片 */
export default function MessageBubble(props: { message: IChatMessage }) {
    const { message } = props;
    const colors = useColors();
    const isUser = message.role === "user";

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
                <ThemeText color={isUser ? "#ffffff" : colors.text} fontSize="content">
                    {message.text}
                </ThemeText>
            </View>
            {!isUser && message.songs?.length ? (
                <View style={styles.cardWrapper}>
                    <SongCard songs={message.songs} />
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
    cardWrapper: {
        width: "100%",
        marginTop: rpx(12),
    },
});
