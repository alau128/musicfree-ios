package com.localllm.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn

interface NativeCallback {
    fun onToken(pieceUtf8: ByteArray)
    fun onFinished()
    fun onError(message: String)
}

class LlamaEngine {
    companion object {
        init {
            System.loadLibrary("llm_chat")
        }
    }

    private var nativePtr: Long = 0L

    val isLoaded: Boolean get() = nativePtr != 0L

    val contextLength: Int
        get() = if (nativePtr != 0L) nativeModelNContext(nativePtr) else 0

    private external fun nativeInit()
    private external fun nativeLoadModel(path: String, nCtx: Int, nThreads: Int): Long
    private external fun nativeModelNContext(ptr: Long): Int
    private external fun nativeApplyTemplate(ptr: Long, roles: Array<String>, contents: Array<String>): String?
    private external fun nativeReset(ptr: Long)
    private external fun nativeGenerate(
        ptr: Long,
        prompt: String,
        maxTokens: Int,
        temperature: Float,
        topP: Float,
        topK: Int,
        repeatPenalty: Float,
        callback: NativeCallback,
    )
    private external fun nativeStop(ptr: Long)
    private external fun nativeFree(ptr: Long)

    fun load(path: String, nCtx: Int = 4096, nThreads: Int = 0) {
        unload()
        nativeInit()
        nativePtr = nativeLoadModel(path, nCtx, nThreads)
    }

    fun unload() {
        if (nativePtr != 0L) {
            nativeFree(nativePtr)
            nativePtr = 0L
        }
    }

    fun stop() {
        if (nativePtr != 0L) {
            nativeStop(nativePtr)
        }
    }

    /** Clear the KV cache so the next generation starts from a fresh context. */
    fun reset() {
        if (nativePtr != 0L) {
            nativeReset(nativePtr)
        }
    }

    /** Build the final prompt from chat history using the model's chat template. */
    fun applyTemplate(messages: List<Pair<String, String>>): String? {
        if (nativePtr == 0L) return null
        val roles = messages.map { it.first }.toTypedArray()
        val contents = messages.map { it.second }.toTypedArray()
        return nativeApplyTemplate(nativePtr, roles, contents)
    }

    fun generate(
        prompt: String,
        maxTokens: Int = 512,
        temperature: Float = 0.8f,
        topP: Float = 0.95f,
        topK: Int = 40,
        repeatPenalty: Float = 1.1f,
    ): Flow<String> = callbackFlow {
        if (nativePtr == 0L) {
            close(IllegalStateException("尚未加载模型"))
            return@callbackFlow
        }
        val callback = object : NativeCallback {
            override fun onToken(pieceUtf8: ByteArray) {
                trySend(String(pieceUtf8, Charsets.UTF_8))
            }

            override fun onFinished() {
                close()
            }

            override fun onError(message: String) {
                close(IllegalStateException(message))
            }
        }
        try {
            nativeGenerate(nativePtr, prompt, maxTokens, temperature, topP, topK, repeatPenalty, callback)
        } catch (t: Throwable) {
            close(t)
        }
        awaitClose { }
    }.flowOn(Dispatchers.IO)
}