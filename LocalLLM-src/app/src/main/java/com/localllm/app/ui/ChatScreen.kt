package com.localllm.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.localllm.app.BuiltinModel
import com.localllm.app.ChatMessage
import com.localllm.app.ChatSession
import com.localllm.app.ChatViewModel
import com.localllm.app.GenerationSettings
import com.localllm.app.ModelInfo
import kotlin.math.roundToInt
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Bg = Color(0xFF101014)
private val SurfaceDark = Color(0xFF18181F)
private val BubbleUser = Color(0xFF3D3BEE)
private val BubbleAssistant = Color(0xFF23232C)
private val TextMuted = Color(0xFF8A8A93)
private val Accent = Color(0xFF6E6BF5)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(vm: ChatViewModel = viewModel()) {
    val messages by vm.messages.collectAsState()
    val generating by vm.generating.collectAsState()
    val selected by vm.selectedModel.collectAsState()
    val status by vm.status.collectAsState()
    val currentId by vm.currentSessionId.collectAsState()
    val sessions by vm.sessions.collectAsState()
    val genTokens by vm.genTokens.collectAsState()
    val genSpeed by vm.genSpeed.collectAsState()
    var input by remember { mutableStateOf("") }
    var showModels by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showSessions by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Scaffold(
        containerColor = Bg,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(currentSessionTitle(sessions, currentId, selected), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceDark),
                actions = {
                    TextButton(onClick = { showSessions = true }) { Text("会话", color = Color.White) }
                    TextButton(onClick = {
                        if (messages.isEmpty()) vm.newSession() else vm.clearChat()
                    }) { Text("新建", color = TextMuted) }
                    TextButton(onClick = { showSettings = true }) { Text("设置", color = TextMuted) }
                    TextButton(onClick = { showModels = true }) { Text("模型", color = Color.White) }
                },
            )
        },
        bottomBar = {
            Surface(color = SurfaceDark) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("输入消息…") },
                        maxLines = 5,
                        shape = RoundedCornerShape(20.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    if (generating) {
                        Button(
                            onClick = { vm.stop() },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD64545)),
                        ) { Text("停止") }
                    } else {
                        Button(
                            onClick = {
                                vm.send(input)
                                input = ""
                            },
                            shape = CircleShape,
                            enabled = input.isNotBlank(),
                            colors = ButtonDefaults.buttonColors(containerColor = BubbleUser),
                        ) { Text("发送") }
                    }
                }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (status.isNotBlank()) {
                Text(
                    status,
                    Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    color = TextMuted,
                    fontSize = 12.sp,
                )
            }
            if (generating) {
                Text(
                    if (genSpeed > 0f) "生成中 · ${genTokens} tokens · %.1f tok/s".format(genSpeed)
                    else "生成中 · ${genTokens} tokens",
                    Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                    color = Color(0xFF4CAF50),
                    fontSize = 12.sp,
                )
            }
            LazyColumn(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(16.dp),
            ) {
                if (messages.isEmpty()) {
                    item {
                        Text(
                            "已加载本地大模型，直接开始对话。\n\n请先在右上角“模型”中选择或下载模型。",
                            color = TextMuted,
                            fontSize = 14.sp,
                        )
                    }
                }
                items(messages) { m -> MessageBubble(m) }
            }
        }
    }

    if (showModels) {
        ModelSheet(vm, onDismiss = { showModels = false })
    }
    if (showSettings) {
        SettingsSheet(vm, onDismiss = { showSettings = false })
    }
    if (showSessions) {
        SessionsSheet(vm, currentId, onDismiss = { showSessions = false })
    }
}

private fun currentSessionTitle(
    sessions: List<ChatSession>,
    currentId: String?,
    selected: ModelInfo?,
): String {
    val cur = sessions.firstOrNull { it.id == currentId }
    return if (cur != null && cur.title != "新对话") {
        cur.title
    } else {
        selected?.name ?: "本地大模型"
    }
}

@Composable
private fun MessageBubble(m: ChatMessage) {
    val isUser = m.role == "user"
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = 340.dp),
        ) {
            Surface(
                color = if (isUser) BubbleUser else BubbleAssistant,
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp,
                ),
                modifier = Modifier.widthIn(max = 340.dp),
            ) {
                if (isUser) {
                    Text(
                        m.content.ifBlank { "…" },
                        Modifier.padding(12.dp),
                        color = Color.White,
                        fontSize = 15.sp,
                        lineHeight = 22.sp,
                    )
                } else {
                    val thinking = ThinkingParser.split(m.content)
                    Column(Modifier.padding(12.dp)) {
                        if (thinking.first != null) {
                            ThinkingSection(thinking.first!!)
                        }
                        val answer = thinking.second
                        if (answer.isNotBlank()) {
                            MarkdownText(answer, baseColor = Color.White)
                        } else if (thinking.first == null) {
                            MarkdownText(m.content.ifBlank { "…" }, baseColor = Color.White)
                        }
                    }
                }
            }
            val clipboard = LocalClipboardManager.current
            if (m.content.isNotBlank()) {
                TextButton(
                    onClick = { clipboard.setText(AnnotatedString(m.content)) },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text("复制", fontSize = 11.sp, color = TextMuted)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionsSheet(vm: ChatViewModel, currentId: String?, onDismiss: () -> Unit) {
    val sessions by vm.sessions.collectAsState()
    var renamingId by remember { mutableStateOf<String?>(null) }
    var renameText by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }

    val filtered = remember(sessions, query) {
        if (query.isBlank()) sessions
        else sessions.filter { s ->
            s.title.contains(query, ignoreCase = true) ||
                s.messages.any { it.content.contains(query, ignoreCase = true) }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = SurfaceDark) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("会话", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Box(Modifier.weight(1f))
                Button(onClick = { vm.newSession(); onDismiss() }, colors = ButtonDefaults.buttonColors(containerColor = BubbleUser)) {
                    Text("新建会话", fontSize = 13.sp)
                }
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                placeholder = { Text("搜索会话标题或内容…") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
            )

            if (filtered.isEmpty()) {
                Text("暂无匹配的会话", Modifier.padding(vertical = 12.dp), color = TextMuted, fontSize = 14.sp)
            }

            LazyColumn {
                items(filtered, key = { it.id }) { s ->
                    val isCurrent = s.id == currentId
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { vm.selectSession(s.id); onDismiss() }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    s.title,
                                    color = if (isCurrent) Color(0xFF8F8CFF) else Color.White,
                                    fontSize = 15.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (isCurrent) {
                                    Spacer(Modifier.width(6.dp))
                                    Text("当前", color = Accent, fontSize = 11.sp)
                                }
                            }
                            val preview = s.messages.firstOrNull { it.role != "system" }?.content?.take(40)
                                ?: "空会话"
                            Text(
                                preview,
                                color = TextMuted,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                formatTime(s.updatedAt),
                                color = TextMuted,
                                fontSize = 11.sp,
                            )
                        }
                        TextButton(onClick = { renamingId = s.id; renameText = s.title }) {
                            Text("改名", color = TextMuted, fontSize = 12.sp)
                        }
                        TextButton(onClick = { vm.deleteSession(s.id) }) {
                            Text("删除", color = Color(0xFFD64545), fontSize = 12.sp)
                        }
                    }
                    if (renamingId == s.id) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = renameText,
                                onValueChange = { renameText = it },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                placeholder = { Text("会话名称") },
                            )
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = {
                                vm.renameSession(s.id, renameText)
                                renamingId = null
                            }) { Text("保存", color = Accent) }
                            TextButton(onClick = { renamingId = null }) { Text("取消", color = TextMuted) }
                        }
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelSheet(vm: ChatViewModel, onDismiss: () -> Unit) {
    val models by vm.models.collectAsState()
    val selected by vm.selectedModel.collectAsState()
    val downloading by vm.downloading.collectAsState()
    val progress by vm.downloadProgress.collectAsState()
    val downloadedBytes by vm.downloadedBytes.collectAsState()
    val downloadTotalBytes by vm.downloadTotalBytes.collectAsState()
    val downloadSpeed by vm.downloadSpeed.collectAsState()
    val loading by vm.loadingModel.collectAsState()

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { vm.importModel(it) }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = SurfaceDark) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            Text("模型管理", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)

            Text("本地模型", Modifier.padding(top = 20.dp, bottom = 8.dp), color = TextMuted, fontSize = 13.sp)
            if (models.isEmpty()) {
                Text("暂无模型，请下载或从文件导入。", color = TextMuted, fontSize = 14.sp)
            }
            models.forEach { m -> ModelRow(m, selected, loading, vm) }

            Text("下载模型（GGUF）", Modifier.padding(top = 24.dp, bottom = 8.dp), color = TextMuted, fontSize = 13.sp)
            vm.builtinChoices.forEach { b ->
                BuiltinRow(b, downloading, progress, downloadedBytes, downloadTotalBytes, downloadSpeed, vm)
            }

            OutlinedButton(
                onClick = { launcher.launch(arrayOf("*/*")) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 24.dp),
            ) { Text("从文件导入 .gguf") }
        }
    }
}

@Composable
private fun ModelRow(m: ModelInfo, selected: ModelInfo?, loading: Boolean, vm: ChatViewModel) {
    val isSelected = selected?.path == m.path
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(m.name, color = Color.White, fontSize = 14.sp)
            Text(formatSize(m.sizeBytes), color = TextMuted, fontSize = 12.sp)
        }
        if (isSelected) {
            Text("已加载", color = Color(0xFF4CAF50), fontSize = 12.sp)
            Spacer(Modifier.width(4.dp))
        }
        TextButton(
            onClick = { vm.selectModel(m) },
            enabled = !loading && !isSelected,
        ) { Text("加载") }
        TextButton(onClick = { vm.deleteModel(m) }, enabled = !loading) { Text("删除", color = Color(0xFFD64545)) }
    }
}

@Composable
private fun BuiltinRow(
    b: BuiltinModel,
    downloading: BuiltinModel?,
    progress: Float,
    downloadedBytes: Long,
    downloadTotalBytes: Long,
    downloadSpeed: Long,
    vm: ChatViewModel,
) {
    val isThis = downloading?.fileName == b.fileName
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${b.name}（${b.approxSize}）", Modifier.weight(1f), color = Color.White, fontSize = 14.sp)
            if (!isThis) {
                TextButton(onClick = { vm.downloadModel(b) }, enabled = downloading == null) { Text("下载") }
            }
        }
        if (isThis) {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
            )
            val detail = buildString {
                append("${(progress * 100).toInt()}%")
                if (downloadedBytes > 0) {
                    append(" · ${formatSize(downloadedBytes)}")
                }
                if (downloadTotalBytes > 0 && downloadedBytes > 0 && downloadedBytes < downloadTotalBytes) {
                    append(" / ${formatSize(downloadTotalBytes)}")
                }
                if (downloadSpeed > 0) {
                    append(" · ${formatSize(downloadSpeed)}/s")
                }
            }
            Text(detail, color = TextMuted, fontSize = 12.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsSheet(vm: ChatViewModel, onDismiss: () -> Unit) {
    val s by vm.settings.collectAsState()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = SurfaceDark) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            Text("生成设置", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(
                "上下文/线程在重新加载模型后生效，采样参数在下一次对话生效。",
                Modifier.padding(top = 4.dp),
                color = TextMuted,
                fontSize = 12.sp,
            )

            SettingSlider(
                label = "上下文长度",
                valueText = "${s.nCtx}",
                value = s.nCtx.toFloat(),
                range = 1024f..16384f,
                steps = 14,
                onValue = { v -> vm.updateSettings(s.copy(nCtx = (v / 1024f).roundToInt() * 1024)) },
            )
            SettingSlider(
                label = "推理线程数",
                valueText = if (s.nThreads == 0) "自动" else "${s.nThreads}",
                value = s.nThreads.toFloat(),
                range = 0f..8f,
                steps = 7,
                onValue = { v -> vm.updateSettings(s.copy(nThreads = v.roundToInt())) },
            )
            SettingSlider(
                label = "温度 (Temperature)",
                valueText = "%.2f".format(s.temperature),
                value = s.temperature,
                range = 0f..2f,
                steps = 0,
                onValue = { v -> vm.updateSettings(s.copy(temperature = v)) },
            )
            SettingSlider(
                label = "Top-P",
                valueText = "%.2f".format(s.topP),
                value = s.topP,
                range = 0f..1f,
                steps = 0,
                onValue = { v -> vm.updateSettings(s.copy(topP = v)) },
            )
            SettingSlider(
                label = "Top-K",
                valueText = "${s.topK}",
                value = s.topK.toFloat(),
                range = 1f..100f,
                steps = 98,
                onValue = { v -> vm.updateSettings(s.copy(topK = v.roundToInt())) },
            )
            SettingSlider(
                label = "重复惩罚 (Repeat Penalty)",
                valueText = "%.2f".format(s.repeatPenalty),
                value = s.repeatPenalty,
                range = 1f..2f,
                steps = 0,
                onValue = { v -> vm.updateSettings(s.copy(repeatPenalty = v)) },
            )
            SettingSlider(
                label = "单次最大生成长度",
                valueText = "${s.maxTokens}",
                value = s.maxTokens.toFloat(),
                range = 128f..2048f,
                steps = 14,
                onValue = { v -> vm.updateSettings(s.copy(maxTokens = (v / 128f).roundToInt() * 128)) },
            )
        }
    }
}

@Composable
private fun SettingSlider(
    label: String,
    valueText: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    onValue: (Float) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = Color.White, fontSize = 14.sp)
            Text(valueText, color = Color(0xFF4CAF50), fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Slider(
            value = value,
            onValueChange = onValue,
            valueRange = range,
            steps = steps,
        )
    }
}

fun formatSize(bytes: Long): String {
    if (bytes <= 0) return ""
    val kb = bytes / 1024.0
    if (kb < 1024) return "%.1f KB".format(kb)
    val mb = kb / 1024.0
    if (mb < 1024) return "%.1f MB".format(mb)
    return "%.2f GB".format(mb / 1024.0)
}

private fun formatTime(ms: Long): String {
    return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(ms))
}