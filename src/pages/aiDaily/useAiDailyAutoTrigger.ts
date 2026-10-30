import bootstrapAtom from "@/entry/bootstrap/bootstrap.atom";
import { autoGenerateIfNeeded, hydrate } from "@/pages/aiDaily/aiDailyService";
import { getDefaultStore } from "jotai";
import { useEffect } from "react";
import { AppState } from "react-native";

/** 首页挂载: bootstrap Done 后自动生成今日日推; 回到前台补检跨天 */
export default function useAiDailyAutoTrigger() {
    useEffect(() => {
        const store = getDefaultStore();
        let disposed = false;

        const check = async () => {
            if (disposed) {
                return;
            }
            if (store.get(bootstrapAtom).state !== "Done") {
                return;
            }
            hydrate();
            await autoGenerateIfNeeded();
        };

        check();

        const unsubscribe = store.sub(bootstrapAtom, () => {
            check();
        });
        const appStateSub = AppState.addEventListener("change", state => {
            if (state === "active") {
                check();
            }
        });

        return () => {
            disposed = true;
            unsubscribe();
            appStateSub.remove();
        };
    }, []);
}
