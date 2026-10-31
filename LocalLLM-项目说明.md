# LocalLLM · 本地大模型 Android App 文字版说明

> 源码位置：`/workspace/LocalLLM-src/`（由 `LocalLLM-source.zip` 解压，已剔除体积巨大的 `app/src/main/cpp/llama.cpp/` 第三方源码目录，原 zip 中该目录完整存在）。

## 一、这是什么

一个纯离线的 Android 本地大模型对话 App。基于 llama.cpp 原生推理，CPU-only，不联网也能对话。主要能力：

1. 加载任意 GGUF 模型（从文件选择器导入，或下载内置模型）；
2. 流式输出，实时显示 token 数与 tok/s；
3. 多会话管理：新建、切换、重命名、删除、按标题/内容搜索；
4. 多轮上下文，借助 KV cache 增量复用，避免每轮重复计算历史；
5. 采样参数可视化调节（上下文长度、线程、temperature、top-p、top-k、重复惩罚、最大生成长度）；
6. 自研 Markdown 渲染（标题/段落/列表/引用/代码块/表格），DeepSeek 思考内容折叠展示。

## 二、技术栈

| 层 | 实现 |
|---|---|
| UI | Kotlin + Jetpack Compose（Material3），Compose BOM 2024.12.01 |
| 推理 | llama.cpp（C/C++，静态链接进 `llm_chat.so`，CPU-only） |
| 桥接 | 手写 JNI：`native-lib.cpp` |
| 异步 | Kotlin Coroutines + `callbackFlow` |
| 网络 | OkHttp 4.12.0（仅用于下载模型） |
| 持久化 | SharedPreferences（设置 + 会话 JSON），无数据库 |
| 构建 | AGP 8.7.3、Kotlin 2.0.21、CMake 3.22.1、NDK 27.2.12479018 |

## 三、目录结构

```
LocalLLM-src/
├── build.gradle.kts                 # AGP/Kotlin/Compose 插件版本声明
├── settings.gradle.kts              # 阿里云镜像 + 仓库配置
├── gradle.properties
├── local.properties                 # sdk.dir（本机相关，需按环境改）
├── keystore.properties              # 签名配置（含明文口令）
├── keystore/release.keystore        # release 签名文件
└── app/
    ├── build.gradle.kts             # Android 构建配置
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── cpp/
        │   ├── CMakeLists.txt       # 编译 llm_chat.so，静态链接 llama
        │   ├── native-lib.cpp       # 全部推理逻辑
        │   └── llama.cpp/           # 第三方源码（zip 内完整，此处未解压）
        ├── java/com/localllm/app/
        │   ├── MainActivity.kt      # 入口，setContent { ChatScreen() }
        │   ├── LlamaEngine.kt       # JNI 封装 + Flow 流式
        │   ├── ChatViewModel.kt     # 会话/设置/模型/生成状态
        │   ├── ModelStore.kt        # 模型扫描、导入、下载、删除
        │   └── ui/
        │       ├── ChatScreen.kt    # 主界面 + 三个 BottomSheet
        │       └── MarkdownText.kt  # Markdown 渲染 + ThinkingParser
        └── res/                     # 图标、主题、字符串（app_name=本地大模型）
```

## 四、整体架构

```
 ChatScreen (Compose)
      │  collectAsState
 ChatViewModel (StateFlow)
      │  generate(prompt) -> Flow<String>
 LlamaEngine (callbackFlow, Dispatchers.IO)
      │  JNI
 native-lib.cpp  ── llama.cpp（llama_model / llama_context / KV cache）
```

- `LlamaEngine` 只做薄封装，不持有业务状态；
- `ChatViewModel` 负责会话、参数、prompt 构建与生成生命周期；
- `native-lib.cpp` 负责真正的模型加载、KV cache 复用与采样。

## 五、Native 推理层（native-lib.cpp）

### 5.1 Session 结构

```cpp
struct Session {
    llama_model * model;
    llama_context * ctx;
    const llama_vocab * vocab;
    std::atomic<bool> abort;          // 中断标志
    std::vector<llama_token> cached;  // 当前 KV cache（seq 0）中完整的 token 流
};
```

`cached` 是增量复用的关键：它记录“已经写进 KV cache 的全部 token”，包括 prompt 与已生成部分。

### 5.2 模型加载

- `n_gpu_layers = 0`，明确 CPU-only；
- `n_ctx` 由调用方传入（默认 4096），`n_batch = 1024`，`n_threads / n_threads_batch` 可配（0 表示交给 llama.cpp 自动）；
- 失败时抛出 `RuntimeException`，错误文案区分“路径为空 / 不是有效 GGUF / 内存不足”。

`nativeModelNContext` 返回的是**训练上下文长度** `llama_model_n_ctx_train`，不是实际配置的 n_ctx。

### 5.3 增量 KV cache 复用（多轮加速核心）

每次生成前：

1. **完整 tokenize 整个 prompt**，参数固定为 `add_special=true, parse_special=false`，保证同一历史前缀的切分稳定；
2. 与 `cached` 逐 token 比较，求出公共前缀长度 `n_common`；
3. 若 `n_common < cached.size()`，用 `llama_memory_seq_rm(mem, 0, n_common, -1)` 回滚 KV cache 的分歧尾部；
4. 只对新增后缀分 batch decode（`llama_batch_get_one`，位置自动续接）；
5. 全部成功后将 `cached = tokens`。

效果：多轮对话中，已缓存的历史不再重算 attention，只计算本轮新增的用户消息。切会话/清空对话时 `nativeReset` 会清空 memory 与 `cached`。

### 5.4 Chat 模板

从模型元数据读取 `tokenizer.chat_template`（固定 16KB 缓冲区），再用 `llama_chat_apply_template(..., add_ass=true)` 渲染完整 prompt。元数据缺失或模板为空时返回 null，由 Kotlin 侧走 fallback 文本模板。

### 5.5 采样链

```cpp
// 仅在 repeat_penalty > 0 且 != 1.0 时加入
llama_sampler_chain_add(smpl, llama_sampler_init_penalties(n_vocab, 64, repeat_penalty, 0.0f, 0.0f));
llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
llama_sampler_chain_add(smpl, llama_sampler_init_top_k(top_k));
llama_sampler_chain_add(smpl, llama_sampler_init_top_p(top_p, 1));
llama_sampler_chain_add(smpl, llama_sampler_init_dist(std::random_device{}()));
```

顺序固定：penalties → temp → top_k → top_p → dist，dist 必须最后。`no_perf = true`。

### 5.6 生成循环与 DeepSeek EOT 处理

```cpp
while (generated < max_tokens) {
    if (abort) break;
    llama_token new_token = llama_sampler_sample(smpl, ctx, -1);
    bool eog = llama_vocab_is_eog(vocab, new_token);
    int32_t lp = llama_token_to_piece(vocab, new_token, buf, sizeof(buf), 0, true);
    if (eog && !is_deepseek_eot(buf, lp)) break;   // 真正的 EOS 才停
    // 回调 onToken(byte[])
    cached.push_back(new_token);
    llama_decode(ctx, llama_batch_get_one(&cached.back(), 1)); // 回喂，保证下一步条件正确
    generated++;
}
```

`is_deepseek_eot` 用字节精确匹配 `<\u3003end\u2581of\u2581sentence\u3003>`。原因：llama.cpp 把这个“思考结束标记”当作 EOG，若直接 break 会截断最终答案，所以遇到它继续生成。

每产出一个 token 立即回喂 KV cache；`abort` 在每个 batch 与每个 token 处检查；回调异常会提前退出。结束统一调用 `onFinished`。

### 5.7 其它 JNI 方法

`nativeInit`（backend init）、`nativeReset`（清 KV 与 cached）、`nativeStop`（置 abort）、`nativeFree`（释放 ctx/model/session）。

## 六、Kotlin 层

### 6.1 LlamaEngine

- `System.loadLibrary("llm_chat")`；
- `load(path, nCtx=4096, nThreads=0)` 先 unload 再加载；
- `generate(...)` 默认 `maxTokens=512, temperature=0.8, topP=0.95, topK=40, repeatPenalty=1.1`；
- 用 `callbackFlow` 把 `onToken(ByteArray)` 转成 UTF-8 字符串流，`onFinished` 关闭流，`onError` 以异常关闭；整体 `flowOn(Dispatchers.IO)`；
- 未加载模型时直接以 `IllegalStateException("尚未加载模型")` 关闭。

### 6.2 ChatViewModel

状态（均为 `StateFlow`）：models / selectedModel / loadingModel / sessions / currentSessionId / messages / generating / status / downloading / downloadProgress / downloadedBytes / downloadTotalBytes / downloadSpeed / genTokens / genSpeed / settings。

- **设置持久化**：SharedPreferences `llm_settings`，键 `n_ctx / n_threads / temp / top_p / top_k / max_tokens / repeat_penalty`。
- **会话持久化**：同一 prefs 的 `sessions_v2`，内容为 JSON 数组（id/title/updatedAt/messages）。启动时读取，空则建“新对话”。
- **模型操作**：`refreshModels` 扫描、`selectModel` 加载、`importModel` 走 SAF、`downloadModel` 下载后自动加载、`deleteModel` 删除并卸载。
- **发送流程** `send(text)`：追加用户消息 → 首轮用前 24 字生成标题 → 构建 prompt → 追加空 assistant 消息 → 收集 Flow，逐段拼接内容，同时统计 token 数与滑动窗口速度（1 秒窗口，另有整体平均）→ 结束后 `persistSessions()`。
- **prompt 构建**：
  - 预算 `budget = (nCtx - maxTokens).coerceAtLeast(256)`；
  - 先按模板渲染，若超过预算则从最早的非 system 消息开始丢弃，循环重渲染；
  - 模板优先 `engine.applyTemplate`，失败时 fallback 为 `用户：/助手：/系统：` 文本并追加 `助手：`。
  - token 估算用 `s.length`（字符数），不是真实 token 计数。
- **会话切换**：`newSession/selectSession` 都会 `engine.reset()`，即切换会话会清 KV cache，不做多会话并行推理。
- **停止**：取消 job + `engine.stop()`。

### 6.3 ModelStore

- **内置下载列表**（均来自 hf-mirror.com）：
  - Qwen2.5-1.5B-Instruct Q4_K_M（约 1.1GB）
  - Qwen2.5-3B-Instruct Q4_K_M（约 2.0GB）
  - Gemma-2-2B-it Q4_K_M（约 1.7GB）
  - Llama-3.2-1B-Instruct Q4_K_M（约 0.8GB）
- **本地扫描**：`filesDir/models`、外部私有目录 `models`，再尽力扫 MediaStore 的 `.gguf`，按修改时间倒序。
- **SAF 导入**：先尝试把 Uri 解析成真实文件路径（`MediaStore.DATA` 列 / `DocumentsContract` 的 `primary:` 卷），能拿到就零拷贝直接使用；否则复制到外部私有目录，文件名做安全化并去重。
- **下载**：OkHttp 流式写入 128KB 缓冲，进度约每 256KB 回调一次；结束后用 `Content-Length` 校验文件大小，不一致则删除报错。无断点续传、无哈希校验。

### 6.4 UI

`ChatScreen`：

- 顶栏：会话 / 新建（消息为空时新建会话，否则清空当前）/ 设置 / 模型；
- 正文：状态行、生成中 token 与 tok/s 行、消息列表、空态提示；
- 底栏：多行输入框 + 发送/停止按钮；
- 三个 `ModalBottomSheet`：
  - 模型管理：本地模型列表（加载/删除）、内置模型下载（进度条、已下载大小、总大小、速度）、从文件导入；
  - 生成设置：7 个滑杆，注明“上下文/线程需重新加载模型生效”；
  - 会话：搜索、新建、切换、改名、删除，显示预览与更新时间。
- 气泡：用户靠右，助手靠左；每条消息下有“复制”按钮。

`MarkdownText.kt`：

- `ThinkingParser.split`：优先按 DeepSeek EOT 拆分“思考 / 回答”；另有一个宽松 fallback：遇 `\u2581`（`▁`）也尝试拆分（对 Qwen3 类输出，可能误判）。
- 自研块级解析：标题、段落、代码块（带语言标签与复制）、有序/无序列表、引用、表格；
- 行内解析：`**粗体**`、`*斜体*`、`` `代码` ``；
- `ThinkingSection`：默认折叠，点“展开/收起”查看思考内容。

## 七、构建

关键版本：`compileSdk 35 / minSdk 26 / targetSdk 35`，Java 17，`abiFilters = arm64-v8a`，`useLegacyPackaging = true`，release 未开启混淆。

CMake 关闭了所有加速与工具目标（Metal/CUDA/Vulkan/BLAS/SYCL/OpenMP 全 OFF，BUILD_SHARED_LIBS OFF），把 llama.cpp 编成静态库，再产出 `llm_chat.so`。

命令（zip 内没有 gradle wrapper 的 jar/properties，需用本机 Gradle 或先 `gradle wrapper`）：

```bash
cd /workspace/LocalLLM-src
# 按本机环境修改 local.properties 的 sdk.dir
gradle assembleRelease --console=plain
```

签名：`keystore.properties` 读取 `storeFile/storePassword/keyAlias/keyPassword`，`keyAlias=localllm`。若文件缺失则回退 debug 签名。产物在 `app/build/outputs/apk/release/`。

## 八、注意事项与已知限制

1. **仅 CPU**：`n_gpu_layers=0`，无 GPU/NPU 加速。
2. **单模型单上下文**：切换会话/新建会话会 reset KV cache，不能并行推理多个会话。
3. **token 估算偏粗**：`estimateTokens = s.length`，中文场景与实际 token 数差距较大，裁剪可能过早或过晚。
4. **会话列表变更未即时落盘**：`newSession` / `deleteSession` 只改内存，未调用 `persistSessions()`；要等下次发送消息或改名才写入。进程被杀可能丢失这些变更。
5. **chat 模板缓冲区固定 16KB**：超长模板会被截断。
6. **下载无哈希校验**：只按 `Content-Length` 比对大小，无断点续传。
7. **MediaStore 扫描依赖 DATA 列**：分区存储下可能扫不到，属于“尽力而为”。
8. **思考折叠的 Qwen fallback 过于宽松**：任何含 `▁` 的文本都可能被当作思考分隔符。
9. **签名口令明文存放**在 `keystore.properties` 中，仓库分发时应注意。
10. **仅 arm64-v8a**，不支持 armeabi-v7a/x86 模拟器。
11. `local.properties` 里是绝对路径 `sdk.dir=/workspace/android-sdk`，换机器必须改。
12. 仓库内含 `.kotlin/sessions` 构建残留，可忽略或清理。
