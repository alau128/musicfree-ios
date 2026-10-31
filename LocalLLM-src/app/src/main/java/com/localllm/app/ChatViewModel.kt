package com.localllm.app

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class ChatMessage(val role: String, val content: String)

data class ChatSession(
    val id: String,
    val title: String,
    val messages: List<ChatMessage>,
    val updatedAt: Long,
)

data class GenerationSettings(
    val nCtx: Int = 4096,
    val nThreads: Int = 0,
    val temperature: Float = 0.8f,
    val topP: Float = 0.95f,
    val topK: Int = 40,
    val maxTokens: Int = 512,
    val repeatPenalty: Float = 1.1f,
)

class ChatViewModel(app: Application) : AndroidViewModel(app) {
    private val engine = LlamaEngine()

    private val _models = MutableStateFlow<List<ModelInfo>>(emptyList())
    val models: StateFlow<List<ModelInfo>> = _models

    private val _selectedModel = MutableStateFlow<ModelInfo?>(null)
    val selectedModel: StateFlow<ModelInfo?> = _selectedModel

    private val _loadingModel = MutableStateFlow(false)
    val loadingModel: StateFlow<Boolean> = _loadingModel

    private val _sessions = MutableStateFlow<List<ChatSession>>(loadSessions())
    val sessions: StateFlow<List<ChatSession>> = _sessions

    private val _currentSessionId = MutableStateFlow<String?>(null)
    val currentSessionId: StateFlow<String?> = _currentSessionId

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _generating = MutableStateFlow(false)
    val generating: StateFlow<Boolean> = _generating

    private val _status = MutableStateFlow("")
    val status: StateFlow<String> = _status

    private val _downloading = MutableStateFlow<BuiltinModel?>(null)
    val downloading: StateFlow<BuiltinModel?> = _downloading

    private val _downloadProgress = MutableStateFlow(0f)
    val downloadProgress: StateFlow<Float> = _downloadProgress

    private val _downloadedBytes = MutableStateFlow(0L)
    val downloadedBytes: StateFlow<Long> = _downloadedBytes

    private val _downloadTotalBytes = MutableStateFlow(-1L)
    val downloadTotalBytes: StateFlow<Long> = _downloadTotalBytes

    private val _downloadSpeed = MutableStateFlow(0L)
    val downloadSpeed: StateFlow<Long> = _downloadSpeed

    private val _genTokens = MutableStateFlow(0)
    val genTokens: StateFlow<Int> = _genTokens

    private val _genSpeed = MutableStateFlow(0f)
    val genSpeed: StateFlow<Float> = _genSpeed

    private val _settings = MutableStateFlow(loadSettings())
    val settings: StateFlow<GenerationSettings> = _settings

    private var generationJob: kotlinx.coroutines.Job? = null

    private fun prefs() = getApplication<Application>().getSharedPreferences("llm_settings", Context.MODE_PRIVATE)

    private fun loadSettings(): GenerationSettings {
        val p = prefs()
        return GenerationSettings(
            nCtx = p.getInt("n_ctx", 4096),
            nThreads = p.getInt("n_threads", 0),
            temperature = p.getFloat("temp", 0.8f),
            topP = p.getFloat("top_p", 0.95f),
            topK = p.getInt("top_k", 40),
            maxTokens = p.getInt("max_tokens", 512),
            repeatPenalty = p.getFloat("repeat_penalty", 1.1f),
        )
    }

    fun updateSettings(s: GenerationSettings) {
        _settings.value = s
        prefs().edit()
            .putInt("n_ctx", s.nCtx)
            .putInt("n_threads", s.nThreads)
            .putFloat("temp", s.temperature)
            .putFloat("top_p", s.topP)
            .putInt("top_k", s.topK)
            .putInt("max_tokens", s.maxTokens)
            .putFloat("repeat_penalty", s.repeatPenalty)
            .apply()
    }

    private fun loadSessions(): List<ChatSession> {
        val raw = prefs().getString("sessions_v2", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                val msgsArr = obj.getJSONArray("messages")
                val msgs = (0 until msgsArr.length()).map { j ->
                    val m = msgsArr.getJSONObject(j)
                    ChatMessage(m.getString("role"), m.getString("content"))
                }
                ChatSession(
                    id = obj.getString("id"),
                    title = obj.getString("title"),
                    messages = msgs,
                    updatedAt = obj.getLong("updatedAt"),
                )
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun persistSessions() {
        val arr = JSONArray()
        for (s in _sessions.value) {
            val obj = JSONObject()
            obj.put("id", s.id)
            obj.put("title", s.title)
            obj.put("updatedAt", s.updatedAt)
            val msgs = JSONArray()
            for (m in s.messages) {
                val mo = JSONObject()
                mo.put("role", m.role)
                mo.put("content", m.content)
                msgs.put(mo)
            }
            obj.put("messages", msgs)
            arr.put(obj)
        }
        prefs().edit().putString("sessions_v2", arr.toString()).apply()
    }

    private fun sortedSessions(list: List<ChatSession>): List<ChatSession> =
        list.sortedByDescending { it.updatedAt }

    init {
        val loaded = loadSessions()
        val seed = if (loaded.isEmpty()) {
            val now = System.currentTimeMillis()
            listOf(ChatSession("session-$now", "新对话", emptyList(), now))
        } else {
            sortedSessions(loaded)
        }
        _sessions.value = seed
        _currentSessionId.value = seed.first().id
        _messages.value = seed.first().messages
        refreshModels()
    }

    val builtinChoices: List<BuiltinModel> get() = ModelStore.builtinModels()

    fun refreshModels() {
        _models.value = ModelStore.listLocalModels(getApplication())
    }

    fun selectModel(model: ModelInfo) {
        if (_generating.value) return
        _selectedModel.value = model
        viewModelScope.launch {
            _loadingModel.value = true
            _status.value = "正在加载模型…"
            try {
                val s = _settings.value
                engine.load(model.path, nCtx = s.nCtx, nThreads = s.nThreads)
                _status.value = "已加载 ${model.name}（上下文 ${engine.contextLength}）"
            } catch (t: Throwable) {
                _status.value = "加载失败：${t.message}"
                _selectedModel.value = null
                engine.unload()
            } finally {
                _loadingModel.value = false
            }
        }
    }

    fun importModel(uri: Uri) {
        viewModelScope.launch {
            _status.value = "正在导入模型…"
            try {
                val info = withContext(Dispatchers.IO) { ModelStore.import(getApplication(), uri) }
                refreshModels()
                selectModel(info)
            } catch (t: Throwable) {
                _status.value = "导入失败：${t.message}"
            }
        }
    }

    fun downloadModel(builtin: BuiltinModel) {
        if (_downloading.value != null) return
        viewModelScope.launch {
            _downloading.value = builtin
            _downloadProgress.value = 0f
            _downloadedBytes.value = 0L
            _downloadTotalBytes.value = -1L
            _downloadSpeed.value = 0L
            _status.value = "开始下载 ${builtin.name}"
            var lastBytes = 0L
            var lastTime = System.nanoTime()
            try {
                val info = ModelStore.download(getApplication(), builtin) { downloaded, total ->
                    _downloadedBytes.value = downloaded
                    _downloadTotalBytes.value = total
                    if (total > 0) _downloadProgress.value = downloaded.toFloat() / total
                    val now = System.nanoTime()
                    val dt = (now - lastTime) / 1e9
                    if (dt >= 0.5) {
                        _downloadSpeed.value = ((downloaded - lastBytes) / dt).toLong()
                        lastBytes = downloaded
                        lastTime = now
                    }
                }
                refreshModels()
                selectModel(info)
            } catch (t: Throwable) {
                _status.value = "下载失败：${t.message}"
            } finally {
                _downloading.value = null
                _downloadProgress.value = 0f
                _downloadedBytes.value = 0L
                _downloadTotalBytes.value = -1L
                _downloadSpeed.value = 0L
            }
        }
    }

    fun deleteModel(model: ModelInfo) {
        ModelStore.delete(model)
        refreshModels()
        if (_selectedModel.value?.path == model.path) {
            engine.unload()
            _selectedModel.value = null
        }
    }

    fun newSession() {
        if (_generating.value) return
        engine.reset()
        val id = "session-${System.currentTimeMillis()}"
        val s = ChatSession(id, "新对话", emptyList(), System.currentTimeMillis())
        _sessions.value = listOf(s) + _sessions.value
        _currentSessionId.value = id
        _messages.value = emptyList()
    }

    fun selectSession(id: String) {
        if (_generating.value) return
        if (id == _currentSessionId.value) return
        engine.reset()
        _currentSessionId.value = id
        val target = _sessions.value.firstOrNull { it.id == id }
        _messages.value = target?.messages ?: emptyList()
    }

    fun deleteSession(id: String) {
        val remaining = _sessions.value.filter { it.id != id }
        val next = if (remaining.isEmpty()) {
            val now = System.currentTimeMillis()
            listOf(ChatSession("session-$now", "新对话", emptyList(), now))
        } else {
            sortedSessions(remaining)
        }
        _sessions.value = next
        if (_currentSessionId.value == id) {
            _currentSessionId.value = next.first().id
            _messages.value = next.first().messages
            engine.reset()
        }
    }

    fun renameSession(id: String, title: String) {
        val trimmed = title.trim().ifBlank { "新对话" }
        _sessions.value = sortedSessions(
            _sessions.value.map { if (it.id == id) it.copy(title = trimmed, updatedAt = it.updatedAt) else it }
        )
        persistSessions()
    }

    fun send(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || _generating.value) return
        if (!engine.isLoaded) {
            _status.value = "请先选择一个模型"
            return
        }

        val history = _messages.value.toMutableList()
        history.add(ChatMessage("user", trimmed))
        _messages.value = history
        val cur = _currentSessionId.value
        if (cur != null) {
            val title = if (history.size <= 2) trimmed.take(24) else _sessions.value.firstOrNull { it.id == cur }?.title
            _sessions.value = sortedSessions(
                _sessions.value.map {
                    if (it.id == cur) it.copy(title = title ?: it.title, updatedAt = System.currentTimeMillis())
                    else it
                }
            )
            persistSessions()
        }
        _generating.value = true

        generationJob = viewModelScope.launch {
            _genTokens.value = 0
            _genSpeed.value = 0f
            val startNs = System.nanoTime()
            try {
                val prompt = buildPrompt(_messages.value)
                val assistantIndex = _messages.value.size
                _messages.value = _messages.value + ChatMessage("assistant", "")

                val s = _settings.value
                var tokens = 0
                var lastSpeedNs = startNs
                var lastSpeedTokens = 0
                engine.generate(
                    prompt,
                    maxTokens = s.maxTokens,
                    temperature = s.temperature,
                    topP = s.topP,
                    topK = s.topK,
                    repeatPenalty = s.repeatPenalty,
                ).collect { piece ->
                    tokens++
                    _genTokens.value = tokens
                    val now = System.nanoTime()
                    val overallElapsed = (now - startNs) / 1e9
                    if (overallElapsed > 0) {
                        _genSpeed.value = (tokens / overallElapsed).toFloat()
                    }
                    val speedWindow = (now - lastSpeedNs) / 1e9
                    if (speedWindow >= 1.0) {
                        _genSpeed.value = ((tokens - lastSpeedTokens) / speedWindow).toFloat()
                        lastSpeedTokens = tokens
                        lastSpeedNs = now
                    }
                    val msgs = _messages.value.toMutableList()
                    if (assistantIndex in msgs.indices) {
                        msgs[assistantIndex] =
                            msgs[assistantIndex].copy(content = msgs[assistantIndex].content + piece)
                        _messages.value = msgs
                    }
                }
                persistSessions()
            } catch (t: Throwable) {
                if (t !is kotlinx.coroutines.CancellationException) {
                    _status.value = "生成失败：${t.message}"
                }
            } finally {
                _generating.value = false
                _genTokens.value = 0
                _genSpeed.value = 0f
            }
        }
    }

    fun stop() {
        generationJob?.cancel()
        engine.stop()
        _generating.value = false
    }

    fun clearChat() {
        if (_generating.value) return
        engine.reset()
        _messages.value = emptyList()
        _currentSessionId.value?.let { id ->
            _sessions.value = sortedSessions(
                _sessions.value.map { if (it.id == id) it.copy(messages = emptyList(), updatedAt = System.currentTimeMillis()) else it }
            )
            persistSessions()
        }
    }

    private fun estimateTokens(s: String): Int = s.length

    private fun buildPrompt(messages: List<ChatMessage>): String {
        val s = _settings.value
        val budget = (s.nCtx - s.maxTokens).coerceAtLeast(256)
        val working = messages.toMutableList()
        var prompt = renderTemplate(working)
        while (estimateTokens(prompt) > budget && working.size > 1) {
            val idx = working.indexOfFirst { it.role != "system" }
            if (idx < 0) break
            working.removeAt(idx)
            prompt = renderTemplate(working)
        }
        return prompt
    }

    private fun renderTemplate(messages: List<ChatMessage>): String {
        val pairs = messages.map { it.role to it.content }
        engine.applyTemplate(pairs)?.let { return it }
        // Fallback (native template unavailable): a simple ChatML-style renderer.
        return buildString {
            for (m in messages) {
                when (m.role) {
                    "user" -> append("用户：").append(m.content)
                    "assistant" -> append("助手：").append(m.content)
                    else -> append("系统：").append(m.content)
                }
                append('\n')
            }
            append("助手：")
        }
    }

    override fun onCleared() {
        generationJob?.cancel()
        engine.unload()
        super.onCleared()
    }
}