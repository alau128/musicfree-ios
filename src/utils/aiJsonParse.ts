/**
 * 从流式 JSON 中提取 "text" 字段已生成的部分 (聊天只上屏正文, 不显示 JSON 原文)
 * 字段尚未出现/未闭合时返回已解析部分; 无法识别返回空串
 */
export function extractStreamingText(raw: string): string {
    const keyIndex = raw.indexOf("\"text\"");
    if (keyIndex < 0) {
        return "";
    }
    let index = raw.indexOf(":", keyIndex + 6);
    if (index < 0) {
        return "";
    }
    index += 1;
    while (index < raw.length && /\s/.test(raw[index])) {
        index += 1;
    }
    if (raw[index] !== "\"") {
        return "";
    }
    index += 1;
    let out = "";
    let escaped = false;
    for (; index < raw.length; index += 1) {
        const ch = raw[index];
        if (escaped) {
            switch (ch) {
            case "n":
                out += "\n";
                break;
            case "t":
                out += "\t";
                break;
            case "r":
                out += "\r";
                break;
            case "\"":
                out += "\"";
                break;
            case "\\":
                out += "\\";
                break;
            case "/":
                out += "/";
                break;
            case "u": {
                const hex = raw.slice(index + 1, index + 5);
                if (hex.length < 4 || /[^0-9a-fA-F]/.test(hex)) {
                    return out;
                }
                out += String.fromCharCode(parseInt(hex, 16));
                index += 4;
                break;
            }
            default:
                out += ch;
            }
            escaped = false;
        } else if (ch === "\\") {
            escaped = true;
        } else if (ch === "\"") {
            break;
        } else {
            out += ch;
        }
    }
    return out;
}

/** 清洗模型输出: 剥 markdown 代码块, 截取首个 JSON 对象 (聊天/日推复用) */
export function parseFirstJsonObject<T = any>(content: string): T | null {
    let cleaned = (content ?? "").trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        cleaned = fence[1].trim();
    }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
        return null;
    }
    try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
        return null;
    }
}
