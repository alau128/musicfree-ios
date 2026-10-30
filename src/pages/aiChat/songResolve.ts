import PluginManager from "@/core/pluginManager";

/**
 * 把模型推荐的歌名核验成真实可播音源 (Phase 8.2 接地)
 * 模型只负责"想推荐什么", 真实条目/音源一律来自插件搜索
 */
const RESOLVE_BUDGET = 25_000;
const SEARCH_LIMIT = 8;
const FILL_LIMIT = 6;

function normalize(value?: string | null) {
    return (value ?? "").toLowerCase().replace(/\s+/g, "");
}

function titleMatches(candidateTitle: string | undefined, wanted: string) {
    const candidate = normalize(candidateTitle);
    const target = normalize(wanted);
    if (!candidate || !target) {
        return false;
    }
    return candidate.includes(target) || target.includes(candidate);
}

export interface IResolveInput {
    title?: string;
    artist?: string;
    aiComment?: string;
}

async function findPlayable(
    title: string,
    artist: string,
    deadline: number,
): Promise<IMusic.IMusicItem | null> {
    const plugins = PluginManager.getSearchablePlugins("music");
    const queries = Array.from(
        new Set([`${title} ${artist}`.trim(), title].filter(Boolean)),
    );
    const seen = new Set<string>();
    for (const query of queries) {
        for (const plugin of plugins) {
            if (Date.now() > deadline) {
                return null;
            }
            const res = await plugin.methods
                .search(query, 1, "music")
                .catch(() => null);
            const candidates = (
                (res?.data ?? []) as unknown as IMusic.IMusicItem[]
            ).slice(0, SEARCH_LIMIT);
            for (const candidate of candidates) {
                if (Date.now() > deadline) {
                    return null;
                }
                if (!titleMatches(candidate.title, title)) {
                    continue;
                }
                const key = `${candidate.platform}@${candidate.id}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                const source = await plugin.methods
                    .getMediaSource(candidate, "standard")
                    .catch(() => null);
                if (source?.url) {
                    return candidate;
                }
            }
        }
    }
    return null;
}

/** 模型歌曲 → 真实歌曲; 不足 3 首时用关键词搜真实歌曲补齐 */
export async function resolveRealSongs(
    songs: IResolveInput[],
    fillKeywords: string[],
): Promise<IMusic.IMusicItem[]> {
    const deadline = Date.now() + RESOLVE_BUDGET;
    const resolved: IMusic.IMusicItem[] = [];
    const used = new Set<string>();
    const add = (item: IMusic.IMusicItem, aiComment?: string) => {
        if (resolved.length >= 3) {
            return false;
        }
        const key = `${item.platform}@${item.id}`;
        const signature = `${normalize(item.title)}|${normalize(item.artist)}`;
        if (used.has(key) || used.has(signature)) {
            return false;
        }
        used.add(key);
        used.add(signature);
        resolved.push(aiComment ? { ...item, aiComment } : item);
        return true;
    };

    for (const song of songs.slice(0, 4)) {
        if (!song.title) {
            continue;
        }
        const found = await findPlayable(
            song.title,
            song.artist ?? "",
            deadline,
        );
        if (found) {
            add(found, song.aiComment);
        }
        if (resolved.length >= 3 || Date.now() > deadline) {
            break;
        }
    }

    const plugins = PluginManager.getSearchablePlugins("music");
    for (const keyword of fillKeywords.slice(0, 3)) {
        if (resolved.length >= 3 || Date.now() > deadline) {
            break;
        }
        for (const plugin of plugins) {
            if (resolved.length >= 3 || Date.now() > deadline) {
                break;
            }
            const res = await plugin.methods
                .search(keyword, 1, "music")
                .catch(() => null);
            const candidates = (
                (res?.data ?? []) as unknown as IMusic.IMusicItem[]
            ).slice(0, FILL_LIMIT);
            for (const candidate of candidates) {
                if (resolved.length >= 3 || Date.now() > deadline) {
                    break;
                }
                if (!candidate.title || !candidate.artist) {
                    continue;
                }
                if (normalize(candidate.title) === normalize(keyword)) {
                    continue;
                }
                const source = await plugin.methods
                    .getMediaSource(candidate, "standard")
                    .catch(() => null);
                if (source?.url) {
                    add(candidate);
                }
            }
        }
    }

    return resolved;
}
