// Phase 3 假 AI 回复: 按关键词匹配场景, 模拟延迟与推荐
// 后续替换为真实 CoreA 调用 (本地模型 / DeepSeek API), 返回结构不变
export interface IAiReply {
  text: string;
  songs: IMusic.IMusicItem[];
}

interface ISceneRule {
  keywords: string[];
  text: string;
  songs: Array<[string, string, string]>; // [title, artist, album]
  aiComment: string;
}

const SCENE_RULES: ISceneRule[] = [
    {
        keywords: ["失恋", "难过", "悲伤", "伤心", "emo"],
        text: "抱抱你。失恋的滋味确实不好受，但时间会让一切慢慢好起来。这几首歌陪着你，把情绪交给旋律吧。",
        songs: [
            ["晴天", "周杰伦", "叶惠美"],
            ["夜曲", "周杰伦", "十一月的萧邦"],
            ["说好的幸福呢", "周杰伦", "魔杰座"],
        ],
        aiComment: "悲伤时听周杰伦，雨过总会天晴",
    },
    {
        keywords: ["周杰伦", "jay"],
        text: "为你挑了几首周杰伦的经典，希望你喜欢～",
        songs: [
            ["晴天", "周杰伦", "叶惠美"],
            ["夜曲", "周杰伦", "十一月的萧邦"],
            ["七里香", "周杰伦", "七里香"],
        ],
        aiComment: "周杰伦经典三连，回忆拉满",
    },
    {
        keywords: ["快乐", "开心", "高兴", "嗨"],
        text: "心情不错呀！来点轻快的歌助助兴～",
        songs: [
            ["Shape of You", "Ed Sheeran", "÷ (Deluxe)"],
            ["Lemon", "米津玄師", "BOOTLEG"],
        ],
        aiComment: "轻快旋律，把好心情拉满",
    },
    {
        keywords: ["睡觉", "晚安", "失眠", "安静"],
        text: "夜深了，来几首温柔的入眠曲吧，晚安～",
        songs: [["平凡之路", "朴树", "猎户星座"]],
        aiComment: "低吟浅唱，伴你入眠",
    },
];

const DEFAULT_RULE: ISceneRule = {
    keywords: [],
    text: "根据你的描述，我为你推荐这几首歌，听听看～",
    songs: [
        ["晴天", "周杰伦", "叶惠美"],
        ["平凡之路", "朴树", "猎户星座"],
        ["Lemon", "米津玄師", "BOOTLEG"],
    ],
    aiComment: "为你精选的每日推荐",
};

let mockId = 0;

export function mockAiReply(input: string): Promise<IAiReply> {
    const lower = input.toLowerCase();
    const rule =
    SCENE_RULES.find(r => r.keywords.some(k => lower.includes(k))) ?? DEFAULT_RULE;

    return new Promise(resolve => {
        setTimeout(() => {
            resolve({
                text: rule.text,
                songs: rule.songs.map(([title, artist, album]) => ({
                    id: `mock-${++mockId}`,
                    platform: "MusicAI",
                    title,
                    artist,
                    album,
                    artwork: "",
                    duration: 0,
                    aiComment: rule.aiComment,
                })),
            });
        }, 1200);
    });
}
