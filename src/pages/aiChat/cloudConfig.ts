import getOrCreateMMKV from "@/utils/getOrCreateMMKV";

const store = getOrCreateMMKV("ai.Chat");
const CLOUD_KEY = "cloudApiKey";
const CLOUD_ENABLED = "cloudEnabled";
const CLOUD_PROVIDER = "cloudProvider";
const CLOUD_BASE_URL = "cloudBaseUrl";
const CLOUD_MODEL = "cloudModel";

export type CloudProvider = "zhipu" | "deepseek" | "custom";

export interface ICloudPreset {
    label: string;
    baseUrl: string;
    model: string;
}

export const CLOUD_PRESETS: Record<"zhipu" | "deepseek", ICloudPreset> = {
    zhipu: {
        label: "智谱免费",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4.5-flash",
    },
    deepseek: {
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
    },
};

export interface ICloudConfig {
    enabled: boolean;
    provider: CloudProvider;
    baseUrl: string;
    model: string;
    apiKey: string;
}

export function getCloudConfig(): ICloudConfig {
    const provider =
        (store.getString(CLOUD_PROVIDER) as CloudProvider) || "zhipu";
    const preset =
        provider === "custom" ? null : CLOUD_PRESETS[provider] ?? null;
    return {
        enabled: store.getBoolean(CLOUD_ENABLED) ?? false,
        provider,
        baseUrl: store.getString(CLOUD_BASE_URL) ?? preset?.baseUrl ?? "",
        model: store.getString(CLOUD_MODEL) ?? preset?.model ?? "",
        apiKey: (store.getString(CLOUD_KEY) ?? "").trim(),
    };
}

export function saveCloudConfig(config: ICloudConfig) {
    store.set(CLOUD_ENABLED, config.enabled);
    store.set(CLOUD_PROVIDER, config.provider);
    store.set(CLOUD_BASE_URL, config.baseUrl.trim());
    store.set(CLOUD_MODEL, config.model.trim());
    store.set(CLOUD_KEY, config.apiKey.trim());
}
