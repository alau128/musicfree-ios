import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import PluginManager from "@/core/pluginManager";
import TrackPlayer from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    View,
} from "react-native";

interface ISongCardProps {
    songs: IMusic.IMusicItem[];
}

function songSignature(song: IMusic.IMusicItem) {
    const title = (song.title ?? "").toLowerCase().replace(/\s+/g, "");
    const artist = (song.artist ?? "").toLowerCase().replace(/\s+/g, "");
    return title ? `${title}|${artist}` : "";
}

/** 歌单卡片: 展示 AI 推荐的歌曲 (已接地为真实音源条目) */
export default function SongCard(props: ISongCardProps) {
    const { songs } = props;
    const colors = useColors();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const uniqueSongs = useMemo(() => {
        const seen = new Set<string>();
        return songs.filter(song => {
            const signature = songSignature(song);
            if (!signature || seen.has(signature)) {
                return false;
            }
            seen.add(signature);
            return true;
        });
    }, [songs]);

    /** 旧消息/离线兜底: 当时的歌可能还是模型虚构条目, 点播时再搜真实音源 */
    async function resolvePlayable(song: IMusic.IMusicItem) {
        const plugins = PluginManager.getSearchablePlugins("music");
        const queries = [`${song.title} ${song.artist}`, song.title];
        for (const query of queries) {
            for (const plugin of plugins) {
                const res = await plugin.methods
                    .search(query, 1, "music")
                    .catch(() => null);
                const candidates = (
                    (res?.data ?? []) as unknown as IMusic.IMusicItem[]
                ).slice(0, 10);
                for (const candidate of candidates) {
                    const source = await plugin.methods
                        .getMediaSource(candidate, "standard")
                        .catch(() => null);
                    if (source?.url) {
                        return { item: candidate, list: candidates };
                    }
                }
            }
        }
        return null;
    }

    async function onPlay(song: IMusic.IMusicItem) {
        if (busyId) {
            return;
        }
        setBusyId(song.id);
        try {
            let target = song;
            let list = uniqueSongs;
            if (song.platform === "MusicAI") {
                const found = await resolvePlayable(song);
                if (!found) {
                    Toast.warn(`没找到《${song.title}》的可播放音源`);
                    return;
                }
                target = found.item;
                list = found.list;
            }
            setPlayingId(song.id);
            await TrackPlayer.playWithReplacePlayList(target, list);
        } catch {
            Toast.warn("播放失败，换首试试");
        } finally {
            setBusyId(null);
        }
    }

    return (
        <View style={[styles.card, { backgroundColor: colors.placeholder }]}>
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
            {uniqueSongs.map((song, index) => (
                <Pressable
                    key={`${song.id}-${index}`}
                    style={styles.songRow}
                    onPress={() => onPlay(song)}>
                    {song.artwork ? (
                        <Image
                            source={{ uri: song.artwork }}
                            style={styles.cover}
                        />
                    ) : (
                        <View
                            style={[
                                styles.cover,
                                styles.coverPlaceholder,
                                {
                                    backgroundColor:
                                        colors.pageBackground ??
                                        colors.background,
                                },
                            ]}>
                            <Icon
                                name="musical-note"
                                size={rpx(28)}
                                color={colors.textSecondary}
                            />
                        </View>
                    )}
                    <View style={styles.songInfo}>
                        <ThemeText
                            fontSize="content"
                            fontWeight="medium"
                            numberOfLines={1}>
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
                    {busyId === song.id ? (
                        <ActivityIndicator
                            size="small"
                            color={colors.textHighlight ?? colors.primary}
                        />
                    ) : (
                        <Icon
                            name={
                                playingId === song.id
                                    ? "motion-play"
                                    : "play-circle-outline"
                            }
                            size={rpx(40)}
                            color={colors.textHighlight ?? colors.primary}
                        />
                    )}
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
        paddingVertical: rpx(12),
    },
    cover: {
        width: rpx(72),
        height: rpx(72),
        borderRadius: rpx(10),
        marginRight: rpx(16),
    },
    coverPlaceholder: {
        alignItems: "center",
        justifyContent: "center",
    },
    songInfo: {
        flex: 1,
        marginRight: rpx(16),
    },
});
