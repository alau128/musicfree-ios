// 自建网易云插件：无混淆，搜索/歌词/歌单导入走网易云官方接口，
// 播放取链先官方后海棠备源（支持 VIP 歌）。
const axios = require("axios");

const PLATFORM = "网易云音乐自建";
const OFFICIAL = "https://music.163.com";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEADERS = {
    "User-Agent": USER_AGENT,
    Referer: OFFICIAL + "/",
};
const RELAY = "https://musicapi.haitangw.net/music/wy_song_kw.php";

function toItem(song) {
    const album = song.al || song.album || {};
    return {
        id: String(song.id),
        platform: PLATFORM,
        title: song.name || "未知歌曲",
        artist:
            (song.ar || song.artists || [])
                .map(a => a && a.name)
                .filter(Boolean)
                .join("/") || "未知歌手",
        album: album.name || "",
        artwork: album.picUrl || "",
        duration: Math.floor(Number(song.dt || 0) / 1000),
    };
}

function parseSheetId(input) {
    const text = String(input == null ? "" : input).trim();
    if (/^\d{5,}$/.test(text)) {
        return text;
    }
    const match =
        /[?&]id=(\d+)/.exec(text) ||
        /playlist\/(\d+)/.exec(text) ||
        /song\/(\d+)/.exec(text);
    if (match) {
        return match[1];
    }
    throw new Error("无法识别歌单链接，请粘贴 music.163.com/playlist?id=数字 或纯数字 ID");
}

module.exports = {
    platform: PLATFORM,
    version: "1.0.0",
    author: "local",
    cacheControl: "no-cache",
    supportedSearchType: ["music"],
    hints: {
        importMusicSheet: [
            "粘贴网易云歌单链接（music.163.com/playlist?id=xxx）或纯数字歌单 ID",
            "公开歌单可直接导入；私密歌单需要公开或另行处理",
        ],
    },

    async search(query, page, type) {
        if (type && type !== "music") {
            return { isEnd: true, data: [] };
        }
        const keyword = String(query || "").trim();
        if (!keyword) {
            return { isEnd: true, data: [] };
        }
        const limit = 30;
        const offset = (Math.max(1, Math.floor(Number(page) || 1)) - 1) * limit;
        const res = await axios.get(OFFICIAL + "/api/cloudsearch/pc", {
            params: { s: keyword, type: 1, limit, offset },
            headers: HEADERS,
            timeout: 15000,
        });
        const result = res.data && res.data.result;
        if (!result) {
            return { isEnd: true, data: [] };
        }
        const songs = result.songs || [];
        return {
            isEnd: offset + songs.length >= Number(result.songCount || 0),
            data: songs.map(toItem),
        };
    },

    async getMediaSource(musicItem, quality) {
        const id = String(musicItem.id);
        const br =
            quality === "high" || quality === "exhigh" || quality === "320k"
                ? 320000
                : quality === "super" ||
                  quality === "lossless" ||
                  quality === "flac"
                ? 999000
                : 128000;

        try {
            const res = await axios.get(OFFICIAL + "/api/song/enhance/player/url", {
                params: { ids: "[" + id + "]", br },
                headers: HEADERS,
                timeout: 12000,
            });
            const data = res.data && res.data.data && res.data.data[0];
            if (data && data.url && !data.freeTrialInfo) {
                return { url: data.url, headers: { Referer: OFFICIAL + "/" } };
            }
        } catch (e) {}

        const level = br >= 999000 ? "lossless" : br >= 320000 ? "exhigh" : "standard";
        const relay = await axios.get(RELAY, {
            params: { type: "json", level, id },
            headers: { "User-Agent": USER_AGENT },
            timeout: 20000,
        });
        const payload = relay.data && relay.data.data;
        if (relay.data && relay.data.code === 200 && payload && payload.url) {
            return { url: payload.url, headers: { "User-Agent": USER_AGENT } };
        }
        throw new Error("网易云取链失败（可能无版权或需 VIP）");
    },

    async getLyric(musicItem) {
        const id = String(musicItem.id);
        const res = await axios.get(OFFICIAL + "/api/song/lyric", {
            params: { id, lv: -1, kv: -1, tv: -1 },
            headers: HEADERS,
            timeout: 12000,
        });
        const data = res.data || {};
        return {
            rawLrc: (data.lrc && data.lrc.lyric) || "",
            translation: (data.tlyric && data.tlyric.lyric) || undefined,
        };
    },

    async importMusicSheet(input) {
        const sheetId = parseSheetId(input);
        const detail = await axios.get(OFFICIAL + "/api/v6/playlist/detail", {
            params: { id: sheetId, n: 1000 },
            headers: HEADERS,
            timeout: 20000,
        });
        const playlist = detail.data && detail.data.playlist;
        if (!playlist) {
            throw new Error("歌单不存在或不可见");
        }
        const ids = (playlist.trackIds || [])
            .map(it => it && it.id)
            .filter(Boolean);
        if (!ids.length) {
            throw new Error("歌单为空（或私密歌单无法读取）");
        }
        const items = [];
        for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100);
            const body =
                "c=" +
                encodeURIComponent(
                    JSON.stringify(chunk.map(id => ({ id }))),
                );
            const res = await axios.post(
                OFFICIAL + "/api/v3/song/detail",
                body,
                {
                    headers: {
                        ...HEADERS,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    timeout: 20000,
                },
            );
            (res.data && res.data.songs ? res.data.songs : []).forEach(song =>
                items.push(toItem(song)),
            );
        }
        if (!items.length) {
            throw new Error("拉取歌曲失败");
        }
        return items;
    },
};
