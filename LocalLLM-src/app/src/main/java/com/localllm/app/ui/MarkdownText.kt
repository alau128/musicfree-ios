package com.localllm.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val CodeBg = Color(0xFF16161C)
private val QuoteColor = Color(0xFF9A9AA5)
private val TableBorder = Color(0xFF2E2E38)
private val Accent = Color(0xFF6E6BF5)

object ThinkingParser {
    // DeepSeek-R1/V3: reasoning ends with this marker before the final answer.
    private const val DEEPSEEK_EOT = "<\u3003end\u2581of\u2581sentence\u3003>"

    /** Split an assistant message into (thinking, answer). Returns null thinking if none. */
    fun split(content: String): Pair<String?, String> {
        val idx = content.indexOf(DEEPSEEK_EOT)
        if (idx >= 0) {
            val before = content.substring(0, idx).trim()
            val after = content.substring(idx + DEEPSEEK_EOT.length)
            return (if (before.isEmpty()) null else before) to after
        }
        // Some Qwen3-style models emit "/  " delimiters; strip those too.
        val qwenIdx = content.indexOf("\u2581")
        if (qwenIdx >= 0) {
            val before = content.substring(0, qwenIdx).trim()
            val after = content.substring(qwenIdx + 1).trimStart('\u2581')
            if (before.isNotEmpty()) return before to after
        }
        return null to content
    }
}

private sealed interface MarkdownBlock {
    data class Heading(val text: String, val level: Int) : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
    data class Code(val code: String, val info: String?) : MarkdownBlock
    data class ListBlock(val items: List<String>, val ordered: Boolean) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Table(val rows: List<List<String>>) : MarkdownBlock
}

private fun parseMarkdown(text: String): List<MarkdownBlock> {
    val lines = text.lines()
    val blocks = ArrayList<MarkdownBlock>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trimStart()
        when {
            line.trim().isEmpty() -> i++
            trimmed.startsWith("```") -> {
                val info = trimmed.removePrefix("```").trim()
                val codeLines = ArrayList<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) {
                    codeLines.add(lines[i]); i++
                }
                i++ // skip closing fence
                blocks.add(MarkdownBlock.Code(codeLines.joinToString("\n"), info.takeIf { it.isNotEmpty() }))
            }
            trimmed.startsWith("#") -> {
                val level = trimmed.takeWhile { it == '#' }.length
                blocks.add(MarkdownBlock.Heading(trimmed.drop(level).trim(), level))
                i++
            }
            trimmed.startsWith("- ") || trimmed.startsWith("* ") -> {
                val items = ArrayList<String>()
                while (i < lines.size && (lines[i].trimStart().startsWith("- ") || lines[i].trimStart().startsWith("* "))) {
                    items.add(lines[i].trimStart().removePrefix("- ").removePrefix("* "))
                    i++
                }
                blocks.add(MarkdownBlock.ListBlock(items, ordered = false))
            }
            trimmed.matches(Regex("""\d+[.)]\s.*""")) -> {
                val items = ArrayList<String>()
                val pat = Regex("""\d+[.)]\s""")
                while (i < lines.size && lines[i].trimStart().matches(pat)) {
                    items.add(lines[i].trimStart().replaceFirst(pat, ""))
                    i++
                }
                blocks.add(MarkdownBlock.ListBlock(items, ordered = true))
            }
            trimmed.startsWith(">") -> {
                val q = ArrayList<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    q.add(lines[i].trimStart().removePrefix(">").trimStart())
                    i++
                }
                blocks.add(MarkdownBlock.Quote(q.joinToString(" ")))
            }
            line.contains("|") && i + 1 < lines.size && lines[i + 1].contains("|") -> {
                val rows = ArrayList<List<String>>()
                while (i < lines.size && lines[i].contains("|")) {
                    rows.add(parseTableRow(lines[i]))
                    i++
                }
                blocks.add(MarkdownBlock.Table(rows))
            }
            else -> {
                val para = ArrayList<String>()
                while (i < lines.size && lines[i].isNotBlank() &&
                    !lines[i].trimStart().startsWith("#") &&
                    !lines[i].trimStart().startsWith("- ") &&
                    !lines[i].trimStart().startsWith("* ") &&
                    !lines[i].trimStart().startsWith("```") &&
                    !lines[i].trimStart().startsWith(">") &&
                    !(lines[i].contains("|") && i + 1 < lines.size && lines[i+1].contains("|")) &&
                    !lines[i].trimStart().matches(Regex("""\d+[.)]\s.*"""))
                ) {
                    para.add(lines[i]); i++
                }
                if (para.isNotEmpty()) blocks.add(MarkdownBlock.Paragraph(para.joinToString("\n")))
            }
        }
    }
    return blocks
}

private fun parseTableRow(line: String): List<String> {
    val raw = line.trim().removePrefix("|").removeSuffix("|")
    return raw.split("|").map { it.trim() }
}

private fun parseInline(text: String): AnnotatedString = buildAnnotatedString {
    val regex = Regex("\\*\\*[^*]+\\*\\*|\\*[^*]+\\*|`[^`]+`")
    var last = 0
    for (m in regex.findAll(text)) {
        append(text.substring(last, m.range.first))
        val token = m.value
        when {
            token.startsWith("**") -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                append(token.removeSurrounding("**"))
            }
            token.startsWith("`") -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Color(0x33FFFFFF))) {
                append(token.removeSurrounding("`"))
            }
            token.startsWith("*") -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                append(token.removeSurrounding("*"))
            }
        }
        last = m.range.last + 1
    }
    if (last < text.length) append(text.substring(last))
}

@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier, baseColor: Color = Color.White) {
    Column(modifier) {
        parseMarkdown(text).forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    val size = when (block.level) {
                        1 -> 20.sp; 2 -> 18.sp; else -> 16.sp
                    }
                    Text(
                        parseInline(block.text),
                        fontSize = size,
                        fontWeight = FontWeight.Bold,
                        color = baseColor,
                        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
                    )
                }
                is MarkdownBlock.Paragraph -> {
                    Text(parseInline(block.text), fontSize = 15.sp, lineHeight = 22.sp, color = baseColor)
                }
                is MarkdownBlock.Quote -> {
                    Row(Modifier.padding(vertical = 4.dp)) {
                        Box(
                            Modifier
                                .width(3.dp)
                                .padding(0.dp)
                                .background(Color(0xFF6E6BF5))
                        )
                        Text(
                            parseInline(block.text),
                            Modifier.padding(start = 8.dp, top = 2.dp, bottom = 2.dp),
                            color = QuoteColor,
                            fontSize = 14.sp,
                        )
                    }
                }
                is MarkdownBlock.Code -> {
                    Surface(
                        color = CodeBg,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                    ) {
                        Column {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            ) {
                                Text(block.info ?: "代码", color = QuoteColor, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                                val clipboard = LocalClipboardManager.current
                                TextButton(onClick = { clipboard.setText(AnnotatedString(block.code)) }) {
                                    Text("复制", color = Accent, fontSize = 12.sp)
                                }
                            }
                            HorizontalDivider(color = TableBorder)
                            Text(
                                block.code,
                                Modifier
                                    .horizontalScroll(rememberScrollState())
                                    .padding(12.dp),
                                color = Color(0xFFD6D6E0),
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                    }
                }
                is MarkdownBlock.ListBlock -> {
                    Column(Modifier.padding(vertical = 2.dp)) {
                        block.items.forEach { item ->
                            Row(Modifier.padding(start = 4.dp, top = 2.dp, bottom = 2.dp)) {
                                Text(
                                    if (block.ordered) "${block.items.indexOf(item) + 1}. " else "• ",
                                    color = Accent,
                                    fontSize = 15.sp,
                                )
                                Text(
                                    parseInline(item),
                                    color = baseColor,
                                    fontSize = 15.sp,
                                    lineHeight = 22.sp,
                                )
                            }
                        }
                    }
                }
                is MarkdownBlock.Table -> {
                    Surface(
                        color = CodeBg,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .horizontalScroll(rememberScrollState()),
                    ) {
                        Column(Modifier.padding(8.dp)) {
                            block.rows.forEachIndexed { ri, row ->
                                if (ri == 1) HorizontalDivider(color = TableBorder)
                                Row {
                                    row.forEach { cell ->
                                        Text(
                                            parseInline(cell),
                                            Modifier
                                                .weight(1f)
                                                .padding(6.dp),
                                            color = if (ri == 0) baseColor else Color(0xFFD6D6E0),
                                            fontSize = if (ri == 0) 14.sp else 13.sp,
                                            fontWeight = if (ri == 0) FontWeight.Bold else FontWeight.Normal,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ThinkingSection(thinking: String) {
    var expanded by remember(thinking) { mutableStateOf(false) }
    Column(
        Modifier
            .padding(top = 2.dp, bottom = 6.dp)
            .fillMaxWidth(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Color(0x140E0E14), RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            Text("深度思考", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Box(Modifier.weight(1f))
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) "收起" else "展开", color = QuoteColor, fontSize = 12.sp)
            }
        }
        if (expanded) {
            Text(
                thinking,
                Modifier.padding(start = 12.dp, top = 4.dp, end = 12.dp),
                color = QuoteColor,
                fontSize = 13.sp,
                lineHeight = 20.sp,
            )
        }
    }
}