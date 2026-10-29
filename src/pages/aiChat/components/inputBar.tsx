import IconButton from "@/components/base/iconButton";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Color from "color";
import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

interface IInputBarProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

/** 底部输入栏: 文本输入 + 发送按钮 */
export default function InputBar(props: IInputBarProps) {
    const { onSend, disabled } = props;
    const colors = useColors();
    const [text, setText] = useState("");

    function send() {
        const value = text.trim();
        if (!value || disabled) {
            return;
        }
        setText("");
        onSend(value);
    }

    return (
        <View
            style={[
                styles.wrapper,
                { backgroundColor: colors.pageBackground ?? colors.background },
            ]}>
            <View style={[styles.inputBox, { backgroundColor: colors.placeholder }]}>
                <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={text}
                    onChangeText={setText}
                    placeholder="想听什么歌？说说你现在的心情…"
                    placeholderTextColor={Color(colors.text).alpha(0.5).toString()}
                    onSubmitEditing={send}
                    returnKeyType="send"
                />
                <IconButton
                    name="arrow-up-tray"
                    sizeType="normal"
                    color={colors.textHighlight ?? colors.primary}
                    onPress={send}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(12),
        paddingBottom: rpx(20),
    },
    inputBox: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: rpx(36),
        paddingHorizontal: rpx(20),
        minHeight: rpx(72),
    },
    input: {
        flex: 1,
        fontSize: rpx(28),
        paddingVertical: 0,
    },
});
