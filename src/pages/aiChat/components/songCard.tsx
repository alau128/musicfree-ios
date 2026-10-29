import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import PluginManager from "@/core/pluginManager";
import TrackPlayer from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface ISongCardProps {
  songs: IMusic.IMusicItem[];
}

/** 歌单卡片: 展示 AI 推荐的歌曲, 点击通过真实音源插件搜索并播放 */
export default function SongCard(props: ISongCardProps) {
    const { songs } = props;
    const colors = useColors();
    const [playingId, setPlayingId] = useState<string | null>(null);

    async function onPlay(item: IMusic.IMusicItem) {
        setPlayingId(item.id);
        try {
            // 用歌名+歌手去真实音源插件搜索, 逐个验证音源可用性, 播放第一个可播的
            const plugins = PluginManager.getSearchablePlugins("music");
            for (const plugin of plugins) {
                const res = await plugin.methods
                    .search(`${item.title} ${item.artist}`, 1, "music")
                    .catch(() => null);
                const candidates = (res?.data ?? []).slice(0, 5);
                for (const candidate of candidates) {
                    const source = await plugin.methods
                        .getMediaSource(candidate, "standard")
                        .catch(() => null);
                    if (source?.url) {
                        await TrackPlayer.playWithReplacePlayList(
              candidate as IMusic.IMusicItem,
              candidates as IMusic.IMusicItem[],
                        );
                        return;
                    }
                }
            }
            // 全部音源不可用时, 兜底直接播放占位数据(会走 App 的换源/跳歌逻辑)
            await TrackPlayer.playWithReplacePlayList(item, songs);
        } catch {
            await TrackPlayer.playWithReplacePlayList(item, songs);
        }
    }

    return (
        <View
            style={[
                styles.card,
                { backgroundColor: colors.placeholder },
            ]}>
            <View style={styles.header}>
                <Icon
                    name="playlist"
                    size={rpx(32)}
                    color={colors.textHighlight ?? colors.primary}
                />
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="bold"
                    style={styles.headerText}>
          推荐歌单
                </ThemeText>
            </View>
            {songs.map((song, index) => (
                <Pressable
                    key={`${song.id}-${index}`}
                    style={styles.songRow}
                    onPress={() => onPlay(song)}>
                    <View style={styles.songInfo}>
                        <ThemeText fontSize="content" fontWeight="medium" numberOfLines={1}>
                            {song.title} - {song.artist}
                        </ThemeText>
                        {!!song.aiComment && (
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                numberOfLines={1}>
                                {song.aiComment}
                            </ThemeText>
                        )}
                    </View>
                    <Icon
                        name={playingId === song.id ? "motion-play" : "play-circle-outline"}
                        size={rpx(40)}
                        color={colors.textHighlight ?? colors.primary}
                    />
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: rpx(16),
        padding: rpx(20),
        width: "100%",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: rpx(12),
    },
    headerText: {
        marginLeft: rpx(12),
    },
    songRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: rpx(16),
    },
    songInfo: {
        flex: 1,
        marginRight: rpx(16),
    },
});
