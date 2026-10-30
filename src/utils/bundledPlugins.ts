import pathConst from "@/constants/pathConst";
import RNFS, { readDir, readFile, unlink } from "react-native-fs";
import { Platform } from "react-native";
import { errorLog } from "@/utils/log";
import { BUNDLED_NETEASE_PLUGIN_SOURCE } from "./bundledPluginSource";

/**
 * 内置插件: 启动时从 APK assets 落到插件目录 (PluginManager.setup 前)
 * marker 用于清理旧的手动安装副本, 避免同一插件出现两份
 */
const BUNDLED_PLUGINS = [
    {
        asset: "plugins/netease-clean.js",
        filename: "netease-clean.js",
        marker: "自建网易云插件",
    },
];

export async function ensureBundledPlugins() {
    for (const item of BUNDLED_PLUGINS) {
        const target = `${pathConst.pluginPath}${item.filename}`;
        try {
            if (Platform.OS === "ios") {
                // iOS 包内无 assets 概念，使用构建时嵌入的插件源码
                await RNFS.writeFile(
                    target,
                    BUNDLED_NETEASE_PLUGIN_SOURCE,
                    "utf8",
                );
            } else {
                await RNFS.copyFileAssets(item.asset, target);
            }
        } catch (e: any) {
            errorLog("内置插件复制失败", e?.message ?? e);
            continue;
        }
        try {
            const files = await readDir(pathConst.pluginPath);
            for (const file of files) {
                if (
                    !file.isFile() ||
                    !file.name.endsWith(".js") ||
                    file.name === item.filename
                ) {
                    continue;
                }
                try {
                    const content = await readFile(file.path, "utf8");
                    if (content.includes(item.marker)) {
                        await unlink(file.path);
                    }
                } catch {}
            }
        } catch {}
    }
}
