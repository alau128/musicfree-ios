// 把内置插件源码嵌入 TS 模块，供 iOS 使用（iOS 无法 copyFileAssets）
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(
    path.join(root, "android/app/src/main/assets/plugins/netease-clean.js"),
    "utf8",
);
const out = `// 由 generator/embed-plugin.mjs 生成，请勿手改
export const BUNDLED_NETEASE_PLUGIN_SOURCE = ${JSON.stringify(src)};
`;
fs.writeFileSync(path.join(root, "src/utils/bundledPluginSource.ts"), out, "utf8");
console.log(`generated src/utils/bundledPluginSource.ts (${src.length} chars)`);
