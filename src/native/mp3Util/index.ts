import { NativeModules } from "react-native";

export interface IBasicMeta {
    album?: string;
    artist?: string;
    author?: string;
    duration?: string;
    title?: string;
}

export interface IWritableMeta extends IBasicMeta {
    lyric?: string;
    comment?: string;
}

interface IMp3Util {
    getBasicMeta: (fileName: string) => Promise<IBasicMeta>;
    getMediaMeta: (fileNames: string[]) => Promise<IBasicMeta[]>;
    getMediaCoverImg: (mediaPath: string) => Promise<string>;
    /** 读取内嵌歌词 */
    getLyric: (mediaPath: string) => Promise<string>;
    /** 写入meta信息 */
    setMediaTag: (filePath: string, meta: IWritableMeta) => Promise<void>;
    getMediaTag: (filePath: string) => Promise<IWritableMeta>;
}

// iOS 未实现本地音频元数据解析：返回空结果，下载/本地歌曲流程降级但不崩
const fallbackMp3Util: IMp3Util = {
    getBasicMeta: async () => ({}),
    getMediaMeta: async () => [],
    getMediaCoverImg: async () => "",
    getLyric: async () => "",
    setMediaTag: async () => {},
    getMediaTag: async () => ({}),
};

const Mp3Util = NativeModules.Mp3Util as IMp3Util | undefined;

export default Mp3Util ?? fallbackMp3Util;
