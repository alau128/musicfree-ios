# Keep JNI native method declarations referenced from C++ via RegisterNatives-free lookup.
-keepclasseswithmembernames class com.localllm.app.LlamaEngine {
    native <methods>;
}