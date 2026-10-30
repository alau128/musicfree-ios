import AppBar from "@/components/base/appBar";
import StatusBar from "@/components/base/statusBar";
import ThemeText from "@/components/base/themeText";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import useColors from "@/hooks/useColors";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useEffect, useRef, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    TextInput,
    View,
} from "react-native";
import InputBar from "./components/inputBar";
import MessageBubble, { IChatMessage } from "./components/messageBubble";
import { aiReply, IChatTurn, testCloudConnection } from "./aiService";
import { probeIosModel } from "./llamaService";
import { startIosModelDownload } from "./modelDownload";
import {
    CLOUD_PRESETS,
    getCloudConfig,
    saveCloudConfig,
} from "./cloudConfig";

let tempId = 0;

const CHAT_STORE = getOrCreateMMKV("ai.Chat");
const MESSAGES_KEY = "messages";
const MAX_PERSISTED = 40;
const MAX_HISTORY_CONTENT = 240;

const WELCOME: IChatMessage = {
    id: "welcome",
    role: "assistant",
    text: "你好，我是你的 AI 点歌助手～ 告诉我你的心情或想听的歌，我来为你推荐。",
};

const QUICK_PROMPTS = [
    "深夜开车听什么",
    "适合专注学习的纯音乐",
    "雨天一个人听",
    "健身燃脂歌单",
    "最近流行的华语说唱",
];

function nextId(prefix: string) {
    tempId += 1;
    return `${prefix}-${Date.now()}-${tempId}`;
}

function loadMessages(): IChatMessage[] {
    const parsed = safeParse<IChatMessage[]>(
        CHAT_STORE.getString(MESSAGES_KEY),
    );
    if (Array.isArray(parsed)) {
        const valid = parsed.filter(
            it =>
                it &&
                (it.role === "user" || it.role === "assistant") &&
                (it.text || it.songs?.length),
        );
        if (valid.length) {
            // 重新编号, 防止跨重启 id 冲突导致消息被覆盖
            const stamp = Date.now();
            return valid.map((it, index) => ({
                ...it,
                id: it.id === "welcome" ? "welcome" : `h-${stamp}-${index}`,
                pending: false,
                status: undefined,
            }));
        }
    }
    return [WELCOME];
}

function buildHistory(messages: IChatMessage[]): IChatTurn[] {
    return messages
        .filter(m => m.id !== "welcome" && !m.pending && !m.error && !!m.text)
        .slice(-6)
        .map(m => {
            let content = m.text.slice(0, MAX_HISTORY_CONTENT);
            if (m.role === "assistant" && m.songs?.length) {
                const songText = m.songs
                    .slice(0, 3)
                    .map(s => `《${s.title}》-${s.artist}`)
                    .join("，");
                content = `${content}\n推荐过：${songText}`.slice(
                    0,
                    MAX_HISTORY_CONTENT,
                );
            }
            return { role: m.role, content };
        });
}

/** AIChat 页面: 自然语言点歌 (本地模型流式 + 多轮上下文) */
export default function AiChat() {
    const colors = useColors();
    const [messages, setMessages] = useState<IChatMessage[]>(loadMessages);
    const [loading, setLoading] = useState(false);
    const [cloudOpen, setCloudOpen] = useState(false);
    const [iosModelFile, setIosModelFile] = useState<
        string | null | undefined
    >(undefined);
    const [cloudDraft, setCloudDraft] = useState(getCloudConfig);
    const [cloudEnabled, setCloudEnabled] = useState(
        () => getCloudConfig().enabled,
    );
    const runningRef = useRef(false);
    const listRef = useRef<FlatList<IChatMessage>>(null);

    useEffect(() => {
        if (loading) {
            return;
        }
        CHAT_STORE.set(
            MESSAGES_KEY,
            safeStringify(messages.slice(-MAX_PERSISTED)),
        );
    }, [messages, loading]);

    function clearChat() {
        if (loading) {
            return;
        }
        setMessages([WELCOME]);
        CHAT_STORE.delete(MESSAGES_KEY);
        Toast.success("已清空对话");
    }

    function openCloudSettings() {
        setCloudDraft(getCloudConfig());
        setCloudOpen(true);
        if (Platform.OS === "ios") {
            refreshIosModel();
        }
    }

    async function refreshIosModel() {
        setIosModelFile(undefined);
        try {
            setIosModelFile(await probeIosModel());
        } catch {
            setIosModelFile(null);
        }
    }

    function saveCloudSettings() {
        saveCloudConfig(cloudDraft);
        setCloudEnabled(cloudDraft.enabled);
        setCloudOpen(false);
        Toast.success(cloudDraft.enabled ? "云端增强已开启" : "已保存");
    }

    async function testCloud() {
        if (!cloudDraft.apiKey.trim() || !cloudDraft.baseUrl.trim()) {
            Toast.warn("请先填写 API Key 和接口地址");
            return;
        }
        try {
            await testCloudConnection(cloudDraft);
            Toast.success("云端连接成功");
        } catch (e: any) {
            Toast.warn(`连接失败：${e?.message ?? "未知错误"}`);
        }
    }

    async function runReply(text: string, appendUser: boolean) {
        if (runningRef.current) {
            return;
        }
        runningRef.current = true;
        const history = buildHistory(messages);
        const assistantId = nextId("a");
        const newMessages: IChatMessage[] = [];
        if (appendUser) {
            newMessages.push({ id: nextId("u"), role: "user", text });
        }
        newMessages.push({
            id: assistantId,
            role: "assistant",
            text: "",
            pending: true,
            status: "准备本地模型…",
        });
        setMessages(prev => [...prev, ...newMessages]);
        setLoading(true);

        const patch = (updater: (m: IChatMessage) => IChatMessage) => {
            setMessages(prev =>
                prev.map(m => (m.id === assistantId ? updater(m) : m)),
            );
        };

        try {
            const { reply, source } = await aiReply(text, {
                history,
                onStatus: status => patch(m => ({ ...m, status })),
                onToken: token =>
                    patch(m => ({
                        ...m,
                        text: m.text + token,
                        pending: false,
                        status: undefined,
                    })),
            });
            const finalText = reply.text?.trim() ?? "";
            if (!finalText) {
                patch(m => ({
                    ...m,
                    pending: false,
                    status: undefined,
                    error: true,
                    retryInput: text,
                    text: "这次没听清，点「重试」再来一次～",
                }));
            } else {
                patch(m => ({
                    ...m,
                    text: finalText,
                    songs: reply.songs,
                    source,
                    pending: false,
                    status: undefined,
                }));
            }
        } catch (e: any) {
            patch(m => ({
                ...m,
                pending: false,
                status: undefined,
                error: true,
                retryInput: text,
                text: `出了点问题：${e?.message ?? "未知错误"}`,
            }));
        } finally {
            runningRef.current = false;
            setLoading(false);
        }
    }

    function onSend(text: string) {
        runReply(text, true).catch(() => {});
    }

    function onRetry(input: string) {
        setMessages(prev =>
            prev.filter(m => !(m.error && m.retryInput === input)),
        );
        runReply(input, false).catch(() => {});
    }

    const showQuickPrompts = messages.length <= 1 && !loading;

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar
                actions={
                    messages.length > 1
                        ? [{ icon: "trash-outline", onPress: clearChat }]
                        : []
                }
                menu={[
                    {
                        icon: "cog-8-tooth",
                        title: cloudEnabled
                            ? "云端 AI：已开启"
                            : "云端 AI：未开启",
                        onPress: openCloudSettings,
                    },
                ]}>
                AI 点歌
            </AppBar>
            <KeyboardAvoidingView
                style={globalStyle.flex1}
                behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <FlatList
                    ref={listRef}
                    style={globalStyle.flex1}
                    contentContainerStyle={{ padding: rpx(24) }}
                    data={messages}
                    keyExtractor={it => it.id}
                    renderItem={({ item }) => (
                        <MessageBubble message={item} onRetry={onRetry} />
                    )}
                    onContentSizeChange={() =>
                        listRef.current?.scrollToEnd({ animated: true })
                    }
                />
                {showQuickPrompts ? (
                    <View style={styles.chips}>
                        {QUICK_PROMPTS.map(prompt => (
                            <Pressable
                                key={prompt}
                                style={[
                                    styles.chip,
                                    { backgroundColor: colors.placeholder },
                                ]}
                                onPress={() => onSend(prompt)}>
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textSecondary">
                                    {prompt}
                                </ThemeText>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <InputBar onSend={onSend} disabled={loading} />
            </KeyboardAvoidingView>
            <Modal
                visible={cloudOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setCloudOpen(false)}>
                <View style={styles.modalMask}>
                    <View
                        style={[
                            styles.modalCard,
                            {
                                backgroundColor:
                                    colors.pageBackground ?? colors.background,
                            },
                        ]}>
                        <ScrollView
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}>
                            {Platform.OS === "ios" ? (
                                <>
                                    <ThemeText
                                        fontSize="subTitle"
                                        fontWeight="bold">
                                        本地模型（iOS）
                                    </ThemeText>
                                    <ThemeText
                                        fontSize="description"
                                        fontColor="textSecondary"
                                        style={styles.modalHint}>
                                        安装包未内置模型：点「下载模型」自动获取（约
                                        1.9GB，建议 Wi-Fi，一次性下载后完全离线）；也可用「文件」App
                                        把 qwen2.5-3b-music-q4_k_m.gguf
                                        放到「我的 iPhone → MusicFree」手动导入。
                                    </ThemeText>
                                    <ThemeText
                                        fontSize="description"
                                        fontColor={
                                            iosModelFile
                                                ? "textHighlight"
                                                : "textSecondary"
                                        }
                                        style={styles.modalHint}>
                                        {iosModelFile === undefined
                                            ? "检测中…"
                                            : iosModelFile
                                                ? "已检测到：" +
                                                iosModelFile
                                                    .split("/")
                                                    .pop()
                                                : "未检测到 .gguf 模型文件"}
                                    </ThemeText>
                                    <View style={styles.modalActions}>
                                        <Pressable
                                            style={styles.modalButton}
                                            onPress={refreshIosModel}>
                                            <ThemeText
                                                fontSize="content"
                                                fontColor="textSecondary">
                                                重新检测
                                            </ThemeText>
                                        </Pressable>
                                        <Pressable
                                            style={styles.modalButton}
                                            onPress={() => {
                                                setCloudOpen(false);
                                                startIosModelDownload().catch(
                                                    () => {},
                                                );
                                            }}>
                                            <ThemeText
                                                fontSize="content"
                                                fontColor="textHighlight">
                                                下载模型（1.9GB）
                                            </ThemeText>
                                        </Pressable>
                                    </View>
                                </>
                            ) : null}
                            <ThemeText fontSize="subTitle" fontWeight="bold">
                            云端 AI（可选）
                            </ThemeText>
                            <ThemeText
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.modalHint}>
                            支持 OpenAI 兼容接口：智谱免费 / DeepSeek / 自定义（硅基流动、OpenRouter、Ollama 等）。开启后优先云端，失败自动回落本地。
                            </ThemeText>
                            <View style={styles.providerRow}>
                                {([
                                    ["zhipu", CLOUD_PRESETS.zhipu.label],
                                    ["deepseek", CLOUD_PRESETS.deepseek.label],
                                    ["custom", "自定义"],
                                ] as Array<[string, string]>).map(
                                    ([value, label]) => {
                                        const active =
                                        cloudDraft.provider === value;
                                        return (
                                            <Pressable
                                                key={value}
                                                style={[
                                                    styles.providerChip,
                                                    {
                                                        borderColor: active
                                                            ? colors.textHighlight ??
                                                          colors.primary
                                                            : colors.placeholder,
                                                        backgroundColor: active
                                                            ? colors.placeholder
                                                            : "transparent",
                                                    },
                                                ]}
                                                onPress={() => {
                                                    if (value === "custom") {
                                                        setCloudDraft(draft => ({
                                                            ...draft,
                                                            provider: "custom",
                                                        }));
                                                        return;
                                                    }
                                                    const preset =
                                                    CLOUD_PRESETS[
                                                        value as
                                                            | "zhipu"
                                                            | "deepseek"
                                                    ];
                                                    setCloudDraft(draft => ({
                                                        ...draft,
                                                        provider: value as
                                                        | "zhipu"
                                                        | "deepseek",
                                                        baseUrl: preset.baseUrl,
                                                        model: preset.model,
                                                    }));
                                                }}>
                                                <ThemeText
                                                    fontSize="description"
                                                    fontColor={
                                                        active
                                                            ? "textHighlight"
                                                            : "textSecondary"
                                                    }>
                                                    {label}
                                                </ThemeText>
                                            </Pressable>
                                        );
                                    },
                                )}
                            </View>
                            <ThemeText
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.fieldLabel}>
                            模型
                            </ThemeText>
                            <TextInput
                                value={cloudDraft.model}
                                onChangeText={value =>
                                    setCloudDraft(draft => ({
                                        ...draft,
                                        model: value,
                                    }))
                                }
                                placeholder="glm-4.5-flash / deepseek-chat"
                                placeholderTextColor={colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={[
                                    styles.keyInput,
                                    styles.fieldInput,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                            />
                            {cloudDraft.provider === "custom" ? (
                                <>
                                    <ThemeText
                                        fontSize="tag"
                                        fontColor="textSecondary"
                                        style={styles.fieldLabel}>
                                    接口地址（Base URL）
                                    </ThemeText>
                                    <TextInput
                                        value={cloudDraft.baseUrl}
                                        onChangeText={value =>
                                            setCloudDraft(draft => ({
                                                ...draft,
                                                baseUrl: value,
                                            }))
                                        }
                                        placeholder="https://api.deepseek.com/v1"
                                        placeholderTextColor={colors.textSecondary}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        style={[
                                            styles.keyInput,
                                            styles.fieldInput,
                                            {
                                                color: colors.text,
                                                backgroundColor:
                                                colors.placeholder,
                                            },
                                        ]}
                                    />
                                </>
                            ) : null}
                            <View style={styles.switchRow}>
                                <ThemeText fontSize="content">
                                启用云端增强
                                </ThemeText>
                                <Switch
                                    value={cloudDraft.enabled}
                                    onValueChange={value =>
                                        setCloudDraft(draft => ({
                                            ...draft,
                                            enabled: value,
                                        }))
                                    }
                                />
                            </View>
                            <TextInput
                                value={cloudDraft.apiKey}
                                onChangeText={value =>
                                    setCloudDraft(draft => ({
                                        ...draft,
                                        apiKey: value,
                                    }))
                                }
                                placeholder="粘贴智谱 API Key（open.bigmodel.cn）"
                                placeholderTextColor={colors.textSecondary}
                                secureTextEntry
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={[
                                    styles.keyInput,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                            />
                            <View style={styles.modalActions}>
                                <Pressable
                                    style={[
                                        styles.modalButton,
                                        styles.testButton,
                                    ]}
                                    onPress={testCloud}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textSecondary">
                                    测试连接
                                    </ThemeText>
                                </Pressable>
                                <Pressable
                                    style={styles.modalButton}
                                    onPress={() => setCloudOpen(false)}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textSecondary">
                                    取消
                                    </ThemeText>
                                </Pressable>
                                <Pressable
                                    style={styles.modalButton}
                                    onPress={saveCloudSettings}>
                                    <ThemeText
                                        fontSize="content"
                                        fontColor="textHighlight">
                                    保存
                                    </ThemeText>
                                </Pressable>
                            </View>
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </VerticalSafeAreaView>
    );
}

const styles = StyleSheet.create({
    chips: {
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(4),
    },
    chip: {
        borderRadius: rpx(24),
        paddingHorizontal: rpx(20),
        paddingVertical: rpx(10),
        marginRight: rpx(12),
        marginBottom: rpx(12),
    },
    modalMask: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.55)",
        justifyContent: "center",
        alignItems: "center",
    },
    modalCard: {
        width: "86%",
        maxHeight: "82%",
        borderRadius: rpx(20),
        padding: rpx(28),
    },
    modalHint: {
        marginTop: rpx(10),
        lineHeight: rpx(36),
    },
    switchRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: rpx(24),
    },
    keyInput: {
        marginTop: rpx(16),
        borderRadius: rpx(12),
        paddingHorizontal: rpx(16),
        height: rpx(80),
    },
    modalActions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        marginTop: rpx(24),
    },
    modalButton: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(10),
    },
    testButton: {
        marginRight: "auto",
    },
    providerRow: {
        flexDirection: "row",
        marginTop: rpx(20),
    },
    providerChip: {
        borderRadius: rpx(18),
        borderWidth: 1,
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        marginRight: rpx(12),
    },
    fieldLabel: {
        marginTop: rpx(16),
    },
    fieldInput: {
        height: rpx(72),
        marginTop: rpx(8),
    },
});
