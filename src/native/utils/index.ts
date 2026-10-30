import { Dimensions, NativeModule, NativeModules } from "react-native";

interface INativeUtils extends NativeModule {
    exitApp: () => void;
    checkStoragePermission: () => Promise<boolean>;
    requestStoragePermission: () => void;
    getWindowDimensions: () => { width: number, height: number }; // Fix bug: https://github.com/facebook/react-native/issues/47080
}

const NativeUtils = NativeModules.NativeUtils as INativeUtils | undefined;

// iOS 无对应原生实现：JS 兜底，避免面板/退出等页面崩溃
const fallbackNativeUtils = {
    exitApp: () => {},
    checkStoragePermission: async () => true,
    requestStoragePermission: () => {},
    getWindowDimensions: () => Dimensions.get("window"),
} as unknown as INativeUtils;

export default NativeUtils ?? fallbackNativeUtils;
