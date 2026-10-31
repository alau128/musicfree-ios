package com.localllm.app

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ModelInfo(
    val name: String,
    val path: String,
    val sizeBytes: Long,
)

data class BuiltinModel(
    val name: String,
    val fileName: String,
    val url: String,
    val approxSize: String,
)

object ModelStore {
    private val builtinModels = listOf(
        BuiltinModel(
            name = "Qwen2.5-1.5B-Instruct（约 1GB）",
            fileName = "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            url = "https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            approxSize = "1.1 GB",
        ),
        BuiltinModel(
            name = "Qwen2.5-3B-Instruct（约 2GB）",
            fileName = "qwen2.5-3b-instruct-q4_k_m.gguf",
            url = "https://hf-mirror.com/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
            approxSize = "2.0 GB",
        ),
        BuiltinModel(
            name = "Gemma-2-2B-it（约 1.7GB）",
            fileName = "gemma-2-2b-it-Q4_K_M.gguf",
            url = "https://hf-mirror.com/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
            approxSize = "1.7 GB",
        ),
        BuiltinModel(
            name = "Llama-3.2-1B-Instruct（约 0.8GB）",
            fileName = "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            url = "https://hf-mirror.com/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            approxSize = "0.8 GB",
        ),
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    fun builtinModels(): List<BuiltinModel> = builtinModels

    private fun modelsDir(context: Context): File {
        val dir = File(context.filesDir, "models")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun externalModelsDir(context: Context): File {
        val dir = File(context.getExternalFilesDir(null), "models")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun sanitizeName(name: String): String {
        return name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "model.gguf" }
    }

    private fun uniqueFile(dir: File, name: String): File {
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
        var f = File(dir, name)
        var i = 1
        while (f.exists()) {
            f = File(dir, "$base-$i$ext")
            i++
        }
        return f
    }

    /** List all discoverable GGUF models: app dirs + best-effort full storage scan. */
    fun listLocalModels(context: Context): List<ModelInfo> {
        val seen = HashSet<String>()
        val result = ArrayList<ModelInfo>()

        fun add(info: ModelInfo) {
            if (info.path.isBlank()) return
            if (seen.add(info.path)) result.add(info)
        }

        listOf(modelsDir(context), externalModelsDir(context)).forEach { dir ->
            if (dir.exists()) {
                dir.listFiles { f -> f.isFile && f.name.endsWith(".gguf", ignoreCase = true) }
                    ?.forEach { f -> add(ModelInfo(f.name, f.absolutePath, f.length())) }
            }
        }

        scanMediaStore(context).forEach { add(it) }

        return result.sortedByDescending { m ->
            try { File(m.path).lastModified() } catch (_: Throwable) { 0L }
        }
    }

    /** Import via SAF: prefer a real path (zero copy); otherwise copy into app storage. */
    fun import(context: Context, uri: Uri): ModelInfo {
        resolveLocalPath(context, uri)?.let { p ->
            val f = File(p)
            return ModelInfo(f.name, f.absolutePath, f.length())
        }
        val displayName = queryDisplayName(context, uri) ?: "model-${System.currentTimeMillis()}.gguf"
        val dest = uniqueFile(externalModelsDir(context), sanitizeName(displayName))
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IOException("无法读取所选文件")
        input.use { src ->
            dest.outputStream().use { out -> src.copyTo(out) }
        }
        return ModelInfo(dest.name, dest.absolutePath, dest.length())
    }

    fun delete(model: ModelInfo) {
        File(model.path).delete()
    }

    suspend fun download(
        context: Context,
        builtin: BuiltinModel,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): ModelInfo = withContext(Dispatchers.IO) {
        val dest = uniqueFile(externalModelsDir(context), sanitizeName(builtin.fileName))

        val request = Request.Builder().url(builtin.url).build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("下载失败：HTTP ${resp.code}")
            val total = resp.body?.contentLength() ?: -1L
            val stream = resp.body?.byteStream()
                ?: throw IOException("响应为空")
            stream.use { input ->
                dest.outputStream().use { out ->
                    val buf = ByteArray(128 * 1024)
                    var read: Int
                    var totalRead = 0L
                    var lastReport = 0L
                    while (input.read(buf).also { read = it } != -1) {
                        out.write(buf, 0, read)
                        totalRead += read
                        // throttle progress callbacks to roughly every 200ms of data
                        if (totalRead - lastReport >= 256 * 1024 || totalRead == total) {
                            onProgress(totalRead, total)
                            lastReport = totalRead
                        }
                    }
                    onProgress(totalRead, total)
                }
            }
            if (total > 0 && dest.length() != total) {
                dest.delete()
                throw IOException("下载不完整（${dest.length()} / $total），请重试")
            }
        }
        ModelInfo(dest.name, dest.absolutePath, dest.length())
    }

    private fun queryDisplayName(context: Context, uri: Uri): String? {
        return context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && cursor.moveToFirst()) cursor.getString(idx) else null
        }
    }

    /** Try to turn a SAF Uri into a real filesystem path so native can read it directly. */
    private fun resolveLocalPath(context: Context, uri: Uri): String? {
        // 1) direct DATA column (works for media/Downloads providers)
        try {
            context.contentResolver.query(
                uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null
            )?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(MediaStore.MediaColumns.DATA)
                    if (idx >= 0) {
                        val p = c.getString(idx)
                        if (!p.isNullOrBlank()) {
                            val f = File(p)
                            if (f.isFile && f.exists()) return f.absolutePath
                        }
                    }
                }
            }
        } catch (_: Throwable) { }

        // 2) externalstorage DocumentsProvider: parse "primary:Download/x.gguf"
        val authority = uri.authority ?: ""
        if (authority.contains("externalstorage", ignoreCase = true) ||
            authority.contains("com.android.providers.downloads", ignoreCase = true)
        ) {
            try {
                val docId = DocumentsContract.getDocumentId(uri)
                val colon = docId.indexOf(':')
                if (colon >= 0) {
                    val vol = docId.substring(0, colon)
                    val rel = docId.substring(colon + 1)
                    val root = if (vol.equals("primary", ignoreCase = true)) {
                        Environment.getExternalStorageDirectory().absolutePath
                    } else {
                        "/storage/$vol"
                    }
                    val f = File(root, rel)
                    if (f.isFile && f.exists()) return f.absolutePath
                }
            } catch (_: Throwable) { }
        }
        return null
    }

    /** Best-effort scan of shared storage for GGUF files (may be empty on scoped storage). */
    private fun scanMediaStore(context: Context): List<ModelInfo> {
        val result = ArrayList<ModelInfo>()
        try {
            val collection = MediaStore.Files.getContentUri("external")
            val projection = arrayOf(
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.DATA,
                MediaStore.Files.FileColumns.SIZE,
            )
            val selection = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?"
            val args = arrayOf("%.gguf")
            context.contentResolver.query(collection, projection, selection, args, null)?.use { c ->
                val nameIdx = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val dataIdx = c.getColumnIndex(MediaStore.Files.FileColumns.DATA)
                val sizeIdx = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
                while (c.moveToNext()) {
                    val data = if (dataIdx >= 0) c.getString(dataIdx) else null
                    if (data != null) {
                        val f = File(data)
                        if (f.isFile && f.exists()) {
                            result.add(ModelInfo(c.getString(nameIdx), f.absolutePath, c.getLong(sizeIdx)))
                        }
                    }
                }
            }
        } catch (_: Throwable) { }
        return result
    }
}