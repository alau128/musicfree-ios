#include <jni.h>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <random>
#include <string>
#include <vector>

#include "llama.h"

namespace {

struct Session {
    llama_model * model = nullptr;
    llama_context * ctx = nullptr;
    const llama_vocab * vocab = nullptr;
    std::atomic<bool> abort{false};
    // Full token stream currently present in the KV cache for sequence 0,
    // including everything decoded so far (prompt + previously generated tokens).
    std::vector<llama_token> cached;
};

Session * get_session(jlong ptr) {
    return reinterpret_cast<Session *>(ptr);
}

void throw_runtime(JNIEnv * env, const char * msg) {
    jclass cls = env->FindClass("java/lang/RuntimeException");
    if (cls != nullptr) {
        env->ThrowNew(cls, msg);
    }
}

std::string jstring_to_utf8(JNIEnv * env, jstring s) {
    if (s == nullptr) {
        return std::string();
    }
    const char * p = env->GetStringUTFChars(s, nullptr);
    if (p == nullptr) {
        return std::string();
    }
    std::string out(p);
    env->ReleaseStringUTFChars(s, p);
    return out;
}

// DeepSeek-R1/V3 end-of-thinking marker token, rendered as text.
// Bytes correspond to "<\u3003end\u2581of\u2581sentence\u3003>".
static bool is_deepseek_eot(const char * buf, int n) {
    static const char kMarker[] =
        "<\xE3\x80\x83" "end" "\xE2\x96\x81" "of" "\xE2\x96\x81" "sentence" "\xE3\x80\x83" ">";
    const int kLen = static_cast<int>(sizeof(kMarker) - 1);
    return n == kLen && memcmp(buf, kMarker, static_cast<size_t>(kLen)) == 0;
}

} // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_com_localllm_app_LlamaEngine_nativeInit(JNIEnv *, jobject) {
    llama_backend_init();
}

JNIEXPORT jlong JNICALL
Java_com_localllm_app_LlamaEngine_nativeLoadModel(
        JNIEnv * env, jobject, jstring path, jint n_ctx, jint n_threads) {
    std::string p = jstring_to_utf8(env, path);
    if (p.empty()) {
        throw_runtime(env, "模型路径为空");
        return 0;
    }

    llama_backend_init();

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0; // CPU only

    llama_model * model = llama_model_load_from_file(p.c_str(), mparams);
    if (model == nullptr) {
        throw_runtime(env, "模型加载失败：请确认该文件是有效的 GGUF 模型");
        return 0;
    }

    llama_context_params cparams = llama_context_default_params();
    if (n_ctx > 0) {
        cparams.n_ctx = static_cast<uint32_t>(n_ctx);
    }
    cparams.n_batch = 1024;
    if (n_threads > 0) {
        cparams.n_threads = n_threads;
        cparams.n_threads_batch = n_threads;
    }

    llama_context * ctx = llama_init_from_model(model, cparams);
    if (ctx == nullptr) {
        llama_model_free(model);
        throw_runtime(env, "创建推理上下文失败：内存可能不足，请减小上下文长度");
        return 0;
    }

    Session * session = new Session();
    session->model = model;
    session->ctx = ctx;
    session->vocab = llama_model_get_vocab(model);
    return reinterpret_cast<jlong>(session);
}

JNIEXPORT jint JNICALL
Java_com_localllm_app_LlamaEngine_nativeModelNContext(JNIEnv *, jobject, jlong ptr) {
    Session * s = get_session(ptr);
    if (s == nullptr || s->model == nullptr) {
        return 0;
    }
    return llama_model_n_ctx_train(s->model);
}

JNIEXPORT jstring JNICALL
Java_com_localllm_app_LlamaEngine_nativeApplyTemplate(
        JNIEnv * env, jobject, jlong ptr, jobjectArray roles, jobjectArray contents) {
    Session * s = get_session(ptr);
    if (s == nullptr || s->model == nullptr) {
        return nullptr;
    }

    char tmpl_buf[16384];
    std::string tmpl;
    int32_t got = llama_model_meta_val_str(
            s->model, "tokenizer.chat_template", tmpl_buf, sizeof(tmpl_buf));
    if (got >= 0) {
        tmpl = tmpl_buf;
    }
    if (tmpl.empty()) {
        return nullptr;
    }

    jsize n = env->GetArrayLength(roles);
    std::vector<llama_chat_message> msgs(static_cast<size_t>(n));
    std::vector<std::string> role_store(static_cast<size_t>(n));
    std::vector<std::string> content_store(static_cast<size_t>(n));

    for (jsize i = 0; i < n; i++) {
        jstring r = static_cast<jstring>(env->GetObjectArrayElement(roles, i));
        jstring c = static_cast<jstring>(env->GetObjectArrayElement(contents, i));
        role_store[i] = jstring_to_utf8(env, r);
        content_store[i] = jstring_to_utf8(env, c);
        env->DeleteLocalRef(r);
        env->DeleteLocalRef(c);
        msgs[i].role = role_store[i].c_str();
        msgs[i].content = content_store[i].c_str();
    }

    int32_t need = llama_chat_apply_template(
            tmpl.c_str(), msgs.data(), msgs.size(), true, nullptr, 0);
    if (need < 0) {
        return nullptr;
    }

    std::vector<char> out(static_cast<size_t>(need) + 1, 0);
    llama_chat_apply_template(
            tmpl.c_str(), msgs.data(), msgs.size(), true, out.data(), need + 1);
    return env->NewStringUTF(out.data());
}

JNIEXPORT void JNICALL
Java_com_localllm_app_LlamaEngine_nativeReset(JNIEnv *, jobject, jlong ptr) {
    Session * s = get_session(ptr);
    if (s == nullptr) {
        return;
    }
    s->abort.store(false);
    s->cached.clear();
    llama_memory_t mem = llama_get_memory(s->ctx);
    if (mem != nullptr) {
        llama_memory_clear(mem, true);
    }
}

JNIEXPORT void JNICALL
Java_com_localllm_app_LlamaEngine_nativeGenerate(
        JNIEnv * env, jobject, jlong ptr, jstring prompt,
        jint max_tokens, jfloat temperature, jfloat top_p, jint top_k,
        jfloat repeat_penalty, jobject callback) {
    Session * s = get_session(ptr);
    jclass cb_cls = env->GetObjectClass(callback);
    jmethodID on_token = env->GetMethodID(cb_cls, "onToken", "([B)V");
    jmethodID on_finished = env->GetMethodID(cb_cls, "onFinished", "()V");
    jmethodID on_error = env->GetMethodID(cb_cls, "onError", "(Ljava/lang/String;)V");

    if (s == nullptr || s->ctx == nullptr) {
        if (on_error != nullptr) {
            env->CallVoidMethod(callback, on_error, env->NewStringUTF("会话未初始化"));
        }
        return;
    }
    if (max_tokens <= 0) {
        max_tokens = 512;
    }

    s->abort.store(false);
    std::string text = jstring_to_utf8(env, prompt);

    // tokenize the full prompt (identical settings to keep cache prefix stable)
    std::vector<llama_token> tokens;
    int32_t n = llama_tokenize(
            s->vocab, text.c_str(), static_cast<int32_t>(text.size()), nullptr, 0, true, false);
    if (n < 0) {
        n = -n;
    }
    if (n <= 0) {
        n = 1;
    }
    tokens.resize(static_cast<size_t>(n));
    n = llama_tokenize(
            s->vocab, text.c_str(), static_cast<int32_t>(text.size()), tokens.data(), n, true, false);
    if (n < 0) {
        if (on_error != nullptr) {
            env->CallVoidMethod(callback, on_error, env->NewStringUTF("分词失败"));
        }
        return;
    }
    tokens.resize(static_cast<size_t>(n));

    // find the common prefix between the cached tokens and the new prompt
    size_t n_common = 0;
    const size_t cached_len = s->cached.size();
    while (n_common < cached_len &&
           n_common < tokens.size() &&
           s->cached[n_common] == tokens[n_common]) {
        n_common++;
    }

    // roll back the diverged tail of the KV cache so only the new suffix is re-decoded
    if (n_common < cached_len) {
        llama_memory_t mem = llama_get_memory(s->ctx);
        if (mem != nullptr) {
            llama_memory_seq_rm(mem, 0, static_cast<llama_pos>(n_common), -1);
        }
    }

    // decode the new suffix (already cached prefix is reused)
    const uint32_t n_batch = llama_n_batch(s->ctx);
    size_t n_cur = n_common;
    while (n_cur < tokens.size()) {
        size_t n_this = std::min<size_t>(static_cast<size_t>(n_batch), tokens.size() - n_cur);
        llama_batch batch = llama_batch_get_one(tokens.data() + n_cur, static_cast<int32_t>(n_this));
        int rc = llama_decode(s->ctx, batch);
        if (rc != 0) {
            if (on_error != nullptr) {
                env->CallVoidMethod(callback, on_error, env->NewStringUTF("推理失败"));
            }
            return;
        }
        n_cur += n_this;
        if (s->abort.load()) {
            return;
        }
    }
    s->cached = tokens;

    int32_t n_vocab = llama_vocab_n_tokens(s->vocab);
    llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    llama_sampler * smpl = llama_sampler_chain_init(sp);
    // penalties first, then temperature/top-k/top-p, distribution sampler last
    if (repeat_penalty > 0.0f && repeat_penalty != 1.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
                n_vocab, 64, repeat_penalty, 0.0f, 0.0f));
    }
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(top_k));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(top_p, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(std::random_device{}()));

    int generated = 0;
    char buf[1024];

    while (generated < max_tokens) {
        if (s->abort.load()) {
            break;
        }

        // sample the next token (the single output of the last evaluation)
        llama_token new_token = llama_sampler_sample(smpl, s->ctx, -1);

        bool eog = llama_vocab_is_eog(s->vocab, new_token);
        int32_t lp = llama_token_to_piece(s->vocab, new_token, buf, sizeof(buf), 0, true);
        // The DeepSeek end-of-thinking marker is EOG-tagged but actually separates reasoning
        // from the final answer. Do not stop there so the answer keeps generating.
        if (eog && !is_deepseek_eot(buf, lp)) {
            break;
        }

        if (lp > 0 && on_token != nullptr) {
            jbyteArray arr = env->NewByteArray(lp);
            if (arr != nullptr) {
                env->SetByteArrayRegion(arr, 0, lp, reinterpret_cast<const jbyte *>(buf));
                env->CallVoidMethod(callback, on_token, arr);
                env->DeleteLocalRef(arr);
            }
        }

        // feed the sampled token back into the KV cache so the next step conditions on it
        s->cached.push_back(new_token);
        llama_batch gbatch = llama_batch_get_one(&s->cached.back(), 1);
        int rc = llama_decode(s->ctx, gbatch);
        if (rc != 0) {
            if (on_error != nullptr) {
                env->CallVoidMethod(callback, on_error, env->NewStringUTF("推理失败"));
            }
            break;
        }
        generated++;

        if (env->ExceptionCheck()) {
            break;
        }
    }

    llama_sampler_free(smpl);
    if (on_finished != nullptr) {
        env->CallVoidMethod(callback, on_finished);
    }
}

JNIEXPORT void JNICALL
Java_com_localllm_app_LlamaEngine_nativeStop(JNIEnv *, jobject, jlong ptr) {
    Session * s = get_session(ptr);
    if (s != nullptr) {
        s->abort.store(true);
    }
}

JNIEXPORT void JNICALL
Java_com_localllm_app_LlamaEngine_nativeFree(JNIEnv *, jobject, jlong ptr) {
    Session * s = get_session(ptr);
    if (s == nullptr) {
        return;
    }
    if (s->ctx != nullptr) {
        llama_free(s->ctx);
    }
    if (s->model != nullptr) {
        llama_model_free(s->model);
    }
    delete s;
}

} // extern "C"