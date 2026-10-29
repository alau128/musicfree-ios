import AppBar from "@/components/base/appBar";
import StatusBar from "@/components/base/statusBar";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import rpx from "@/utils/rpx";
import React, { useRef, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import InputBar from "./components/inputBar";
import MessageBubble, { IChatMessage } from "./components/messageBubble";
import { aiReply } from "./aiService";

let tempId = 0;

/** AIChat 页面: 自然语言点歌 (Phase 3, 当前为本地假数据) */
export default function AiChat() {
    const [messages, setMessages] = useState<IChatMessage[]>([
        {
            id: "welcome",
            role: "assistant",
            text: "你好，我是你的 AI 点歌助手～ 告诉我你的心情或想听的歌，我来为你推荐。",
        },
    ]);
    const [loading, setLoading] = useState(false);
    const listRef = useRef<FlatList<IChatMessage>>(null);

    async function onSend(text: string) {
        const userMsg: IChatMessage = { id: `u-${++tempId}`, role: "user", text };
        const assistantId = `a-${++tempId}`;
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);
        // 先挂一个空 AI 气泡, 本地推理时逐字流式填充
        setMessages(prev => [
            ...prev,
            { id: assistantId, role: "assistant", text: "" },
        ]);

        function appendText(token: string) {
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId ? { ...m, text: m.text + token } : m,
                ),
            );
        }

        try {
            const { reply, source } = await aiReply(text, {
                onToken: appendText,
            });
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId
                        ? { ...m, text: reply.text, songs: reply.songs, source }
                        : m,
                ),
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>AI 点歌</AppBar>
            <KeyboardAvoidingView
                style={globalStyle.flex1}
                behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <FlatList
                    ref={listRef}
                    style={globalStyle.flex1}
                    contentContainerStyle={{ padding: rpx(24) }}
                    data={messages}
                    keyExtractor={it => it.id}
                    renderItem={({ item }) => <MessageBubble message={item} />}
                    onContentSizeChange={() =>
                        listRef.current?.scrollToEnd({ animated: true })
                    }
                />
                <InputBar onSend={onSend} disabled={loading} />
            </KeyboardAvoidingView>
        </VerticalSafeAreaView>
    );
}
