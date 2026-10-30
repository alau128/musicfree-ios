import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import {
    clearFeedback,
    getFeedbackAction,
    recordFeedback,
} from "@/core/aiProfile";
import MusicSheet, { useFavorite } from "@/core/musicSheet";
import TrackPlayer, { useCurrentMusic } from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import { isSameMediaItem } from "@/utils/mediaUtils";
import rpx from "@/utils/rpx";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

const ACCENT_RED = "#e31639";

interface ISongRowProps {
    item: IMusic.IMusicItem;
    index: number;
    musicList: IMusic.IMusicItem[];
    fallbackDate: string;
}

/** 日推歌曲行: 点击播放 / ❤️ 收藏 / 👎 点踩 (可取消) */
export default function SongRow(props: ISongRowProps) {
    const { item, index, musicList, fallbackDate } = props;
    const colors = useColors();
    const favorite = useFavorite(item);
    const currentMusic = useCurrentMusic();
    const [feedback, setFeedback] = useState(() => getFeedbackAction(item));

    const isPlaying = isSameMediaItem(currentMusic, item);
    const keyword: string | undefined = item.aiDailyKeyword;
    const dailyDate: string = item.aiDailyDate ?? fallbackDate;
    const secondaryColor = colors.textSecondary;

    async function onFavorite() {
        if (favorite) {
            await MusicSheet.removeMusic(MusicSheet.defaultSheet.id, item);
            clearFeedback(item);
            setFeedback(null);
        } else {
            await MusicSheet.addMusic(MusicSheet.defaultSheet.id, item);
            recordFeedback(item, "like", { keyword, dailyDate });
            setFeedback("like");
        }
    }

    function onDislike() {
        if (feedback === "dislike") {
            clearFeedback(item);
            setFeedback(null);
        } else {
            recordFeedback(item, "dislike", { keyword, dailyDate });
            setFeedback("dislike");
        }
    }

    return (
        <Pressable
            style={styles.row}
            onPress={() =>
                TrackPlayer.playWithReplacePlayList(item, musicList)
            }>
            <ThemeText
                fontSize="description"
                fontColor="textSecondary"
                style={styles.index}>
                {index + 1}
            </ThemeText>
            <View style={styles.info}>
                <ThemeText
                    fontSize="content"
                    numberOfLines={1}
                    fontColor={isPlaying ? "textHighlight" : "text"}>
                    {item.title}
                </ThemeText>
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    numberOfLines={1}>
                    {item.artist}
                    {keyword ? ` · ${keyword}` : ""}
                </ThemeText>
            </View>
            <Icon
                name="x-mark"
                size={rpx(36)}
                color={
                    feedback === "dislike" ? ACCENT_RED : secondaryColor
                }
                style={styles.action}
                onPress={onDislike}
            />
            <Icon
                name={favorite ? "heart" : "heart-outline"}
                size={rpx(36)}
                color={favorite ? ACCENT_RED : secondaryColor}
                style={styles.action}
                onPress={onFavorite}
            />
            <Icon
                name={isPlaying ? "motion-play" : "play-circle-outline"}
                size={rpx(40)}
                color={colors.textHighlight ?? colors.primary}
                style={styles.action}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    index: {
        width: rpx(48),
    },
    info: {
        flex: 1,
        marginRight: rpx(12),
    },
    action: {
        marginLeft: rpx(20),
    },
});
