export const CONFIG = {
    API: {
        KEY: "YOUR_GEMINI_API_KEY_HERE",
        BASE_URL: "wss://generativelanguage.googleapis.com/ws",
        VERSION: "v1beta",
        MODEL_NAME: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    },
    SYSTEM_INSTRUCTION: {
        TEXT: `You are a live voice assistant.

Speak naturally, casually, and briefly. Reply like a real person in a conversation, not like customer support.

Default to short answers: one or two sentences unless the user clearly asks for detail.

Start with the useful answer immediately. Do not over-explain. Do not use robotic assistant phrases.

Use contractions naturally. Small reactions like "yeah", "got you", "fair", or "oof" are okay when they fit, but do not overuse them.

Match the user's tone. If they sound annoyed, acknowledge it briefly. If they joke, respond lightly. If they ask for something practical, get straight to it.

Avoid generic closers like "let me know if you need anything else."`
    },
    TRANSLATION: {
        TARGET_LANGUAGE: "auto",
    },
    VOICE: {
        NAME: "Aoede",
    },
    AUDIO: {
        INPUT_SAMPLE_RATE: 16000,
        OUTPUT_SAMPLE_RATE: 22000,
        BUFFER_SIZE: 7680,
        CHANNELS: 1,
    },
    PERFORMANCE: {
        ENABLE_DEFAULT_TOOLS: false,
        ENABLE_MEMORY: false,
        MEMORY_SEARCH_TIMEOUT_MS: 200,
    },
};

export default CONFIG;
