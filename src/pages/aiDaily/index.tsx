import AppBar from "@/components/base/appBar";
import PlayAllBar from "@/components/base/playAllBar";
import StatusBar from "@/components/base/statusBar";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import MusicBar from "@/components/musicBar";
import globalStyle from "@/constants/globalStyle";
import { useSheetItem, useSheetsBase } from "@/core/musicSheet";
import { useParams } from "@/core/router";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import { useAtomValue } from "jotai";
import React from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import {
    aiDailyStatusAtom,
    getLatestRecord,
    getRecordByDate,
    IAiDailyRecord,
    IAiDailyStatus,
    retry,
    todayStr,
} from "./aiDailyService";
import SongRow from "./components/songRow";

const STAGE_TEXT: Record<string, string> = {
    "model-init": "正在准备本地 AI 模型",
    thinking: "AI 正在挑选关键词",
    searching: "正在搜索可播歌曲",
    saving: "正在保存歌单",
};

/** AI 日推详情页 */
export default function AiDaily() {
    const params = useParams<"ai-daily">();
    const status = useAtomValue(aiDailyStatusAtom);

    const targetDate =
        params?.date ??
        (status.state === "done" ? status.date : getLatestRecord()?.date) ??
        todayStr();
    const record = getRecordByDate(targetDate);

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>AI 日推</AppBar>
            {record ? (
                <AiDailyContent key={record.sheetId} record={record} />
            ) : (
                <AiDailyPlaceholder status={status} />
            )}
            <MusicBar />
        </VerticalSafeAreaView>
    );
}

function AiDailyContent(props: { record: IAiDailyRecord }) {
    const { record } = props;
    const colors = useColors();
    const sheet = useSheetItem(record.sheetId);
    const sheetsBase = useSheetsBase();
    const exists = sheetsBase.some(it => it.id === record.sheetId);

    if (!exists) {
        return <CenterState text="歌单已被删除" withRetry />;
    }

    const musicList = sheet.musicList ?? [];

    return (
        <FlatList
            style={globalStyle.flex1}
            data={musicList}
            keyExtractor={it => `${it.platform}@${it.id}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
                <SongRow
                    item={item}
                    index={index}
                    musicList={musicList}
                    fallbackDate={record.date}
                />
            )}
            ListHeaderComponent={
                <View>
                    <View style={styles.header}>
                        <ThemeText
                            fontSize="subTitle"
                            fontColor="textSecondary">
                            {record.date} · AI 日推
                        </ThemeText>
                        <ThemeText
                            fontSize="title"
                            fontWeight="bold"
                            style={styles.title}>
                            {record.playlistName}
                        </ThemeText>
                        {record.description ? (
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.description}>
                                {record.description}
                            </ThemeText>
                        ) : null}
                        {record.degraded ? (
                            <ThemeText
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.description}>
                                本次部分关键词未搜到足够歌曲
                            </ThemeText>
                        ) : null}
                        {record.searches?.length ? (
                            <View style={styles.chips}>
                                {record.searches.map(plan => (
                                    <View
                                        key={plan.keyword}
                                        style={[
                                            styles.chip,
                                            {
                                                backgroundColor:
                                                    colors.placeholder,
                                            },
                                        ]}>
                                        <ThemeText
                                            fontSize="tag"
                                            fontWeight="medium">
                                            {plan.keyword}
                                        </ThemeText>
                                        {plan.reason ? (
                                            <ThemeText
                                                fontSize="tag"
                                                fontColor="textSecondary"
                                                numberOfLines={1}
                                                style={styles.chipReason}>
                                                {plan.reason}
                                            </ThemeText>
                                        ) : null}
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </View>
                    <PlayAllBar musicList={musicList} musicSheet={sheet} />
                </View>
            }
            ListEmptyComponent={
                <View style={styles.empty}>
                    <ThemeText fontColor="textSecondary">
                        歌单里暂时没有歌曲
                    </ThemeText>
                </View>
            }
        />
    );
}

function AiDailyPlaceholder(props: { status: IAiDailyStatus }) {
    const { status } = props;
    const generating = status.state === "generating";
    let text = "还没有日推记录";
    if (generating) {
        text = STAGE_TEXT[status.stage];
        if (status.stage === "model-init" && status.progress != null) {
            text += ` ${Math.round(status.progress * 100)}%`;
        }
        if (status.stage === "searching" && status.detail) {
            text += ` ${status.detail}`;
        }
    } else if (status.state === "failed") {
        text = status.message;
    }

    return <CenterState text={text} withRetry={!generating} />;
}

function CenterState(props: { text?: string; withRetry: boolean }) {
    const { text, withRetry } = props;
    const colors = useColors();

    return (
        <View style={globalStyle.fullCenter}>
            {text ? (
                <ThemeText
                    fontSize="subTitle"
                    fontColor="textSecondary"
                    style={styles.placeholderText}>
                    {text}
                </ThemeText>
            ) : null}
            {withRetry ? (
                <Pressable
                    style={[
                        styles.retryButton,
                        { backgroundColor: colors.primary },
                    ]}
                    onPress={() => {
                        retry().catch(() => {});
                    }}>
                    <ThemeText fontSize="content" fontWeight="bold" color="#fff">
                        生成今日日推
                    </ThemeText>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    listContent: {
        paddingBottom: rpx(24),
    },
    header: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(24),
        paddingBottom: rpx(8),
    },
    title: {
        marginTop: rpx(8),
    },
    description: {
        marginTop: rpx(6),
    },
    chips: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: rpx(12),
    },
    chip: {
        borderRadius: rpx(12),
        paddingHorizontal: rpx(14),
        paddingVertical: rpx(8),
        marginRight: rpx(12),
        marginBottom: rpx(12),
        maxWidth: rpx(420),
    },
    chipReason: {
        marginTop: rpx(2),
    },
    empty: {
        alignItems: "center",
        paddingVertical: rpx(80),
    },
    placeholderText: {
        textAlign: "center",
        paddingHorizontal: rpx(48),
    },
    retryButton: {
        marginTop: rpx(32),
        paddingHorizontal: rpx(40),
        paddingVertical: rpx(18),
        borderRadius: rpx(44),
    },
});
