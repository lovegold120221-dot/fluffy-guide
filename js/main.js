import { MultimodalLiveClient } from "./core/websocket-client.js"
import { AudioStreamer } from "./audio/audio-streamer.js"
import { AudioRecorder } from "./audio/audio-recorder.js"
import { CONFIG } from "./config/config.js"
import { Logger } from "./utils/logger.js"
import { VideoManager } from "./video/video-manager.js"
import { ScreenRecorder } from "./video/screen-recorder.js"
import { searchMemory, addMemory } from "./utils/memory.js" // Import Memo AI functions
import { ApplicationError } from "./utils/error-boundary.js"

// === Conversation History Management (localStorage) ===
const CONVERSATION_STORAGE_KEY = "eburon_conversation_history"
const MAX_CONVERSATION_HISTORY = 50 // Keep last 50 conversation turns

function saveConversationToHistory(userMessage, assistantMessage) {
  try {
    const history = JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) || "[]")
    history.push({
      user: userMessage,
      assistant: assistantMessage,
      timestamp: Date.now(),
    })
    // Keep only the last MAX_CONVERSATION_HISTORY turns
    if (history.length > MAX_CONVERSATION_HISTORY) {
      history.shift()
    }
    localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(history))
  } catch (error) {
    Logger.error("Failed to save conversation to localStorage:", error)
  }
}

function getConversationHistory() {
  try {
    return JSON.parse(localStorage.getItem(CONVERSATION_STORAGE_KEY) || "[]")
  } catch (error) {
    Logger.error("Failed to load conversation from localStorage:", error)
    return []
  }
}

function clearConversationHistory() {
  try {
    localStorage.removeItem(CONVERSATION_STORAGE_KEY)
  } catch (error) {
    Logger.error("Failed to clear conversation history:", error)
  }
}

function generateOpeningMessageFromHistory() {
  const history = getConversationHistory()
  if (history.length === 0) {
    return "Hey Boss! I'm Beatrice. What's on your mind today?"
  }

  const lastConversation = history[history.length - 1]
  const recentTopics = history.slice(-5).map(h => h.user).join("; ")
  
  const openingMessages = [
    `Hey Boss! Last time we talked about "${lastConversation.user.substring(0, 50)}...". How's that going?`,
    `Welcome back, Boss! You mentioned "${lastConversation.user.substring(0, 50)}..." earlier. Any updates?`,
    `Hi Boss! I remember we were discussing "${lastConversation.user.substring(0, 50)}...". Want to continue that?`,
    `Hey Boss! Good to see you again. We were talking about "${lastConversation.user.substring(0, 50)}..." last time.`,
    `Welcome back, Boss! Based on our recent chats about "${recentTopics.substring(0, 80)}...", what's new?`,
  ]

  return openingMessages[Math.floor(Math.random() * openingMessages.length)]
}
import {
  auth,
  db,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  ref,
  get,
  set,
  update,
} from "./firebase.js"

/**
 * @fileoverview Main entry point for the application.
 * Initializes and manages the UI, audio, video, and WebSocket interactions.
 * Now includes Memo AI integration to persist chat history and use it as long-term memory.
 */

// === DOM Elements ===
const logsContainer = document.getElementById("logs-container")
const messageInput = document.getElementById("message-input")
const sendButton = document.getElementById("send-button")
const micButton = document.getElementById("mic-button")
const micIcon = document.getElementById("mic-icon")
const audioVisualizer = document.getElementById("audio-visualizer")
const connectButton = document.getElementById("connect-button")
const cameraButton = document.getElementById("camera-button")
const cameraIcon = document.getElementById("camera-icon")
const flipCameraButton = document.getElementById("flip-camera-button")
const stopVideoButton = document.getElementById("stop-video")
const screenButton = document.getElementById("screen-button")
const screenIcon = document.getElementById("screen-icon")
const screenContainer = document.getElementById("screen-container")
const screenPreview = document.getElementById("screen-preview")
const videoContainer = document.getElementById("video-container")
const textStreamingArea = document.getElementById("text-streaming-area")
const conversationContainer = document.getElementById("conversation-container")
const inputAudioVisualizer = document.getElementById("input-audio-visualizer")
const micVisualizer = document.getElementById("mic-visualizer")
const appContainer = document.getElementById("app")
const attachButton = document.getElementById("attach-button")
const attachInput = document.getElementById("attach-input")
const attachmentChips = document.getElementById("attachment-chips")
const voiceSelect = document.getElementById("voice-select")
const sampleRateInput = document.getElementById("sample-rate-input")
const systemInstructionInput = document.getElementById("system-instruction")
const applyConfigButton = document.getElementById("apply-config")
const configToggle = document.getElementById("config-toggle")
const toggleLogs = document.getElementById("toggle-logs")
const logsWrapper = document.querySelector(".logs-wrapper")
const configContainer = document.getElementById("config-container")

// === Theme Switcher ===
const themeToggle = document.getElementById("theme-toggle")
const root = document.documentElement
const savedTheme = localStorage.getItem("theme") || "dark"
root.setAttribute("data-theme", savedTheme)
// No need to change text content anymore since we're using CSS to show the icon

themeToggle?.addEventListener("click", () => {
  const currentTheme = root.getAttribute("data-theme")
  const newTheme = currentTheme === "dark" ? "light" : "dark"
  root.setAttribute("data-theme", newTheme)
  localStorage.setItem("theme", newTheme)
  // No need to change text content anymore since we're using CSS to show the icon
})

// === State Variables ===
let isRecording = false
let audioStreamer = null
let audioCtx = null
let isConnected = false
let audioRecorder = null
let isVideoActive = false
let videoManager = null
let isScreenSharing = false
let screenRecorder = null
let isUsingTool = false

// Global variables for Memo AI integration – store latest conversation turn
let lastUserMessage = ""
let lastAssistantMessage = ""

// Current streaming message for conversation display
let currentStreamingMessage = null


// === Modern frontend helpers ===
const mediaLayer = document.getElementById("mediaLayer")
const pipWindow = document.getElementById("pipWindow")

function setConnectButtonLabel(label, connected = false) {
  connectButton.innerHTML = connected
    ? '<i class="ph-fill ph-phone-x"></i><span>End</span>'
    : '<i class="ph-fill ph-plugs"></i><span>Connect</span>'
  if (label && !connected) {
    connectButton.querySelector("span").textContent = label
  }
  connectButton.classList.toggle("connected", connected)
}

function setButtonActive(button, activeClass, active) {
  button.classList.toggle(activeClass, Boolean(active))
}

function setPhosphorFill(icon, filled) {
  if (!icon) return
  icon.classList.toggle("ph-fill", Boolean(filled))
  icon.classList.toggle("ph", !filled)
}

function setMicVisualState() {
  setButtonActive(micButton, "active-mic", isRecording)
  micIcon.className = isRecording ? "ph-fill ph-microphone" : "ph-fill ph-microphone-slash"
  audioVisualizer.classList.toggle("active", isRecording)
}

function setMediaLayerState(state) {
  mediaLayer?.classList.remove("camera-active", "screen-active")
  if (state === "camera") mediaLayer?.classList.add("camera-active")
  if (state === "screen") mediaLayer?.classList.add("screen-active")
  // Hide the streaming chat when video / screen share is active so they fully fill the frame
  appContainer?.classList.toggle("media-active", state === "camera" || state === "screen")
}

// === Multimodal Client ===
const client = new MultimodalLiveClient({ apiKey: CONFIG.API.KEY })

// === Initialize Configuration Values ===
voiceSelect.value = CONFIG.VOICE.NAME
sampleRateInput.value = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
systemInstructionInput.value = CONFIG.SYSTEM_INSTRUCTION.TEXT

// Configuration presets
const CONFIG_PRESETS = {
  friendly: {
    voice: "Aoede",
    sampleRate: 27000,
    systemInstruction: "You are a friendly and warm AI assistant. Use a casual, approachable tone and be encouraging.",
  },
  professional: {
    voice: "Charon",
    sampleRate: 24000,
    systemInstruction:
      "You are a professional AI expert. Maintain a formal tone, be precise and thorough in your explanations. Focus on accuracy and clarity in all interactions.",
  },
  tired: {
    voice: "Aoede",
    sampleRate: 16000,
    systemInstruction:
      "You are very tired, exhausted, and grumpy. Respond in a lazy and unenthusiastic tone unless absolutely necessary.",
  },
}

/**
 * Updates the configuration and reconnects if needed.
 */
async function updateConfiguration() {
  const newVoice = voiceSelect.value
  const newSampleRate = Number.parseInt(sampleRateInput.value)
  const newInstruction = systemInstructionInput.value.trim()

  if (isNaN(newSampleRate) || newSampleRate < 1000 || newSampleRate > 48000) {
    logMessage("Invalid sample rate. Must be between 1000 and 48000 Hz.", "system")
    return
  }

  CONFIG.VOICE.NAME = newVoice
  CONFIG.AUDIO.OUTPUT_SAMPLE_RATE = newSampleRate
  CONFIG.SYSTEM_INSTRUCTION.TEXT = newInstruction

  localStorage.setItem("gemini_voice", newVoice)
  localStorage.setItem("gemini_output_sample_rate", newSampleRate.toString())
  localStorage.setItem("gemini_system_instruction", newInstruction)

  if (audioStreamer) {
    audioStreamer.stop()
    audioStreamer = null
  }

  if (isConnected) {
    logMessage("Reconnecting to apply configuration changes...", "system")
    await disconnectFromWebsocket()
    await connectToWebsocket()
  }

  logMessage("Configuration updated successfully", "system")
  if (window.innerWidth <= 768) {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
}

// Load saved configuration if exists
if (localStorage.getItem("gemini_voice")) {
  CONFIG.VOICE.NAME = localStorage.getItem("gemini_voice")
  voiceSelect.value = CONFIG.VOICE.NAME
}
if (localStorage.getItem("gemini_output_sample_rate")) {
  CONFIG.AUDIO.OUTPUT_SAMPLE_RATE = Number.parseInt(localStorage.getItem("gemini_output_sample_rate"))
  sampleRateInput.value = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
}
if (localStorage.getItem("gemini_system_instruction")) {
  CONFIG.SYSTEM_INSTRUCTION.TEXT = localStorage.getItem("gemini_system_instruction")
  systemInstructionInput.value = CONFIG.SYSTEM_INSTRUCTION.TEXT
}

applyConfigButton.addEventListener("click", updateConfiguration)
configToggle.addEventListener("click", () => {
  configContainer.classList.toggle("active")
  configToggle.classList.toggle("active")
})
document.addEventListener("click", (event) => {
  if (!configContainer.contains(event.target) && !configToggle.contains(event.target) && window.innerWidth > 768) {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
})
configContainer.addEventListener("click", (event) => {
  event.stopPropagation()
})
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
})
toggleLogs.addEventListener("click", toggleServerLogs)
function handleMobileView() {
  if (window.innerWidth <= 768) {
    logsWrapper.classList.add("collapsed")
    // No need to change text content anymore since we're using CSS to show the icon
  } else {
    logsWrapper.classList.remove("collapsed")
    // No need to change text content anymore since we're using CSS to show the icon
  }
}
window.addEventListener("resize", handleMobileView)
handleMobileView()
document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = CONFIG_PRESETS[button.dataset.preset]
    if (preset) {
      voiceSelect.value = preset.voice
      sampleRateInput.value = preset.sampleRate
      systemInstructionInput.value = preset.systemInstruction
      updateConfiguration()
      button.style.backgroundColor = "var(--primary-color)"
      button.style.color = "white"
      setTimeout(() => {
        button.style.backgroundColor = ""
        button.style.color = ""
      }, 200)
    }
  })
})

/**
 * Logs a message to the logs container.
 */
function logMessage(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString()
  const logEntry = document.createElement("div")
  logEntry.className = `log-entry ${type}`
  
  let emoji = "📝"
  switch (type) {
    case "system":
      emoji = "⚙️"
      break
    case "user":
      emoji = "👤"
      break
    case "ai":
      emoji = "🤖"
      break
    case "error":
      emoji = "❌"
      break
    case "success":
      emoji = "✅"
      break
  }
  
  logEntry.innerHTML = `
    <span class="timestamp">${timestamp}</span>
    <span class="emoji">${emoji}</span>
    <span class="message">${message}</span>
  `
  
  logsContainer.appendChild(logEntry)
  logsContainer.scrollTop = logsContainer.scrollHeight
}

/**
 * Adds a message to the conversation text streaming area.
 */
function addConversationMessage(text, type = "ai") {
  const messageDiv = document.createElement("div")
  messageDiv.className = `conversation-message ${type}`
  
  messageDiv.innerHTML = `
    <div class="message-text">${text}</div>
  `
  
  conversationContainer.appendChild(messageDiv)
  conversationContainer.scrollTop = conversationContainer.scrollHeight
}

/**
 * Adds a streaming message (updates in real-time).
 */
function addStreamingMessage(initialText = "", role = "ai") {
  const messageDiv = document.createElement("div")
  messageDiv.className = `conversation-message ${role} streaming`

  messageDiv.innerHTML = `
    <div class="message-text">${initialText}</div>
  `

  conversationContainer.appendChild(messageDiv)
  conversationContainer.scrollTop = conversationContainer.scrollHeight

  return messageDiv
}

/**
 * Updates a streaming message with new text.
 */
function updateStreamingMessage(messageElement, text) {
  const textElement = messageElement.querySelector(".message-text")
  if (textElement) {
    textElement.textContent = text
  }
  conversationContainer.scrollTop = conversationContainer.scrollHeight
}

/**
 * Finalizes a streaming message.
 */
function finalizeStreamingMessage(messageDiv) {
  messageDiv.classList.remove("streaming")
}

/**
 * Toggles server logs visibility.
 */
function toggleServerLogs() {
  const logsWrapper = document.querySelector(".logs-wrapper")
  if (logsWrapper) {
    logsWrapper.classList.toggle("hidden")
    const isHidden = logsWrapper.classList.contains("hidden")
    logMessage(isHidden ? "Server logs hidden" : "Server logs shown", "system")
  }
}

/**
 * Cleans AI response text to show only the actual response content.
 */
function cleanAIResponse(text) {
  // Remove code blocks and metadata
  let cleaned = text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/```.*$/gm, '') // Remove incomplete code blocks
    .replace(/metadata:.*$/gm, '') // Remove metadata lines
    .replace(/thinking:.*$/gm, '') // Remove thinking lines
    .replace(/```/g, '') // Remove any remaining backticks
    .replace(/\*\*.*?\*\*/g, '') // Remove bold formatting
    .replace(/\*.*?\*/g, '') // Remove italic formatting
    .trim()
  
  // Split into lines and filter out empty or metadata-like lines
  const lines = cleaned.split('\n')
    .filter(line => {
      const trimmed = line.trim()
      return trimmed && 
             !trimmed.includes('metadata') && 
             !trimmed.includes('thinking') &&
             !trimmed.includes('```') &&
             !trimmed.match(/^[a-zA-Z_]+:.*$/) // Filter out key: value patterns
    })
    .join('\n')
  
  return lines
}

/**
 * Updates the microphone icon.
 */
function updateMicIcon() {
  setMicVisualState()
}

/**
 * Updates the audio visualizer.
 */
function renderBars(container, volume) {
  const bars = container?.querySelectorAll(".bar") || []
  bars.forEach((bar, index) => {
    const multiplier = 0.7 + index * 0.18
    // randomize a touch so the bars feel alive instead of moving in lockstep
    const jitter = 0.85 + Math.random() * 0.3
    const height = Math.max(4, Math.min(16, Math.round(volume * 16 * multiplier * jitter)))
    bar.style.height = `${height}px`
  })
}

function updateAudioVisualizer(volume, isInput = false) {
  if (isInput) {
    // legacy single-bar element (kept hidden for compat)
    const audioBar = inputAudioVisualizer?.querySelector(".audio-bar")
    if (audioBar) {
      audioBar.style.width = `${volume * 100}%`
      audioBar.classList.toggle("active", volume > 0)
    }
    // new bar-style visualizer at the mic button — synced look with the AI one
    renderBars(micVisualizer, volume)
    micVisualizer?.classList.toggle("active", volume > 0.02 || isRecording)
    return
  }

  renderBars(audioVisualizer, volume)
  audioVisualizer?.classList.toggle("active", volume > 0.02)
}

// === AI output visualizer sync ===
// Hooks an AnalyserNode onto the AudioStreamer's gainNode and drives the
// header visualizer in real-time so the bars actually reflect what the AI
// is saying instead of just toggling on/off.
let outputAnalyser = null
let outputAnalyserData = null
let outputRafId = null

function startOutputVisualizerLoop() {
  if (outputRafId) return
  const tick = () => {
    if (!outputAnalyser) {
      outputRafId = null
      return
    }
    outputAnalyser.getByteFrequencyData(outputAnalyserData)
    let sum = 0
    for (let i = 0; i < outputAnalyserData.length; i++) sum += outputAnalyserData[i]
    const avg = sum / outputAnalyserData.length / 255
    updateAudioVisualizer(avg, false)
    outputRafId = requestAnimationFrame(tick)
  }
  outputRafId = requestAnimationFrame(tick)
}

let analyserSourceNode = null
function attachOutputAnalyser() {
  if (!audioCtx || !audioStreamer) return
  try {
    if (!outputAnalyser) {
      outputAnalyser = audioCtx.createAnalyser()
      outputAnalyser.fftSize = 256
      outputAnalyser.smoothingTimeConstant = 0.7
      outputAnalyserData = new Uint8Array(outputAnalyser.frequencyBinCount)
    }
    // The streamer recreates its gainNode after stop() — reconnect when it changes.
    if (analyserSourceNode !== audioStreamer.gainNode) {
      analyserSourceNode = audioStreamer.gainNode
      // Tap the streamer's gain node in parallel — doesn't affect playback.
      analyserSourceNode?.connect(outputAnalyser)
    }
    startOutputVisualizerLoop()
  } catch (err) {
    Logger.warn?.("Failed to attach output analyser", err)
  }
}

/**
 * Initializes the audio context and streamer.
 */
async function ensureAudioInitialized() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (!audioStreamer) {
    audioStreamer = new AudioStreamer(audioCtx)
    audioStreamer.sampleRate = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
    await audioStreamer.initialize()
  }
  attachOutputAnalyser()
  return audioStreamer
}

/**
 * Handles the microphone toggle.
 */
// === Mic input visualizer sync ===
// Runs a dedicated RAF loop reading the input analyser so the bars react
// smoothly to the live mic level instead of only when audio chunks ship.
let inputAnalyser = null
let inputAnalyserData = null
let inputSourceNode = null
let inputRafId = null

function startInputVisualizerLoop() {
  if (inputRafId) return
  const tick = () => {
    if (!inputAnalyser || !isRecording) {
      inputRafId = null
      updateAudioVisualizer(0, true)
      return
    }
    inputAnalyser.getByteFrequencyData(inputAnalyserData)
    // Use RMS-style average for a stable, voice-shaped response.
    let sum = 0
    for (let i = 0; i < inputAnalyserData.length; i++) {
      sum += inputAnalyserData[i] * inputAnalyserData[i]
    }
    const rms = Math.sqrt(sum / inputAnalyserData.length) / 255
    // Light gain so quiet speech still moves the bars; clamp to [0,1].
    const volume = Math.min(1, rms * 2.2)
    updateAudioVisualizer(volume, true)
    inputRafId = requestAnimationFrame(tick)
  }
  inputRafId = requestAnimationFrame(tick)
}

function stopInputVisualizerLoop() {
  if (inputRafId) {
    cancelAnimationFrame(inputRafId)
    inputRafId = null
  }
  if (inputSourceNode) {
    try { inputSourceNode.disconnect() } catch (_) { /* noop */ }
    inputSourceNode = null
  }
  inputAnalyser = null
  inputAnalyserData = null
  updateAudioVisualizer(0, true)
}

async function handleMicToggle() {
  if (!isRecording) {
    try {
      await ensureAudioInitialized()
      audioRecorder = new AudioRecorder()
      inputAnalyser = audioCtx.createAnalyser()
      inputAnalyser.fftSize = 512
      inputAnalyser.smoothingTimeConstant = 0.6
      inputAnalyserData = new Uint8Array(inputAnalyser.frequencyBinCount)
      await audioRecorder.start((base64Data) => {
        if (isUsingTool) {
          client.sendRealtimeInput([
            {
              mimeType: "audio/pcm;rate=16000",
              data: base64Data,
              interrupt: true,
            },
          ])
        } else {
          client.sendRealtimeInput([
            {
              mimeType: "audio/pcm;rate=16000",
              data: base64Data,
            },
          ])
        }
      })
      if (audioRecorder.stream) {
        inputSourceNode = audioCtx.createMediaStreamSource(audioRecorder.stream)
        inputSourceNode.connect(inputAnalyser)
      }
      await audioStreamer.resume()
      isRecording = true
      startInputVisualizerLoop()
      Logger.info("Microphone started")
      logMessage("Microphone started", "system")
      updateMicIcon()
    } catch (error) {
      Logger.error("Microphone error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isRecording = false
      stopInputVisualizerLoop()
      updateMicIcon()
    }
  } else {
    if (audioRecorder && isRecording) {
      audioRecorder.stop()
    }
    isRecording = false
    stopInputVisualizerLoop()
    logMessage("Microphone stopped", "system")
    updateMicIcon()
  }
}

/**
 * Connects to the WebSocket server.
 */
async function connectToWebsocket() {
  const config = {
    model: CONFIG.API.MODEL_NAME,
    generationConfig: {
      responseModalities: "audio",
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: CONFIG.VOICE.NAME,
          },
        },
      },
    },
    systemInstruction: {
      parts: [
        {
          text: CONFIG.SYSTEM_INSTRUCTION.TEXT,
        },
      ],
    },
    // Ask the server to transcribe both the user's mic input and the model's spoken output
    // so we can render live captions in the chat.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    enableDefaultTools: CONFIG.PERFORMANCE?.ENABLE_DEFAULT_TOOLS === true,
  }
  try {
    await client.connect(config)
    isConnected = true
    setConnectButtonLabel("End", true)
    messageInput.disabled = false
    sendButton.disabled = false
    micButton.disabled = false
    cameraButton.disabled = false
    screenButton.disabled = false
    logMessage("Connected Flash Multimodal Live API", "system")
    const initAudioHandler = async () => {
      try {
        await ensureAudioInitialized()
        document.removeEventListener("click", initAudioHandler)
      } catch (error) {
        Logger.error("Audio initialization error:", error)
      }
    }
    document.addEventListener("click", initAudioHandler)
    logMessage("Audio initialized", "system")
  } catch (error) {
    const errorMessage = error.message || "Unknown error"
    Logger.error("Connection error:", error)
    logMessage(`Connection error: ${errorMessage}`, "system")
    isConnected = false
    setConnectButtonLabel("Connect", false)
    messageInput.disabled = true
    sendButton.disabled = true
    micButton.disabled = true
    cameraButton.disabled = true
    screenButton.disabled = true
  }
}

/**
 * Disconnects from the WebSocket server.
 */
function disconnectFromWebsocket() {
  client.disconnect()
  isConnected = false
  if (audioStreamer) {
    audioStreamer.stop()
    if (audioRecorder) {
      audioRecorder.stop()
      audioRecorder = null
    }
    isRecording = false
    updateMicIcon()
  }
  setConnectButtonLabel("Connect", false)
  messageInput.disabled = true
  sendButton.disabled = true
  micButton.disabled = true
  cameraButton.disabled = true
  screenButton.disabled = true
  logMessage("Disconnected from server", "system")
  if (videoManager) {
    stopVideo()
  }
  if (screenRecorder) {
    stopScreenSharing()
  }
}

/**
 * Handles sending a text message with Memo AI integration.
 * Retrieves relevant memories from Mem0 and appends them as context.
 */
async function handleSendMessage() {
  const message = messageInput.value.trim()
  const hasAttachments = pendingAttachments.length > 0
  if (!message && !hasAttachments) return

  // Snapshot + clear pending attachments so subsequent sends don't re-include them.
  const attachments = pendingAttachments.slice()
  clearAttachments()

  if (message) {
    logMessage(message, "user")
    lastUserMessage = message
    addConversationMessage(message, "user")
  } else {
    addConversationMessage(`📎 ${attachments.map(a => a.name).join(", ")}`, "user")
  }
  messageInput.value = ""

  // Build inlineData parts for any attachments + text part.
  const inlineParts = attachments.map(att => ({
    inlineData: { mimeType: att.mimeType, data: att.base64 },
  }))

  // Fast path: no blocking memory lookup.
  if (CONFIG.PERFORMANCE?.ENABLE_MEMORY !== true) {
    const parts = [...inlineParts]
    if (message) parts.push({ text: message })
    client.send(parts)
    return
  }

  let memoriesText = ""
  try {
    const memories = await searchMemory(
      message || "",
      "default",
      CONFIG.PERFORMANCE?.MEMORY_SEARCH_TIMEOUT_MS || 200
    )
    if (memories && memories.length > 0) {
      memoriesText = memories.map((entry) => entry.memory || entry.text || "").join("\n")
    }
  } catch (error) {
    Logger.error("Error retrieving memories:", error)
  }

  const compositeMessage = memoriesText ? `${message}

Context from past conversations:
${memoriesText}` : message
  const parts = [...inlineParts]
  if (compositeMessage) parts.push({ text: compositeMessage })
  client.send(parts)
}

// === Attachments ===
const pendingAttachments = [] // { name, mimeType, size, base64, url }
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024 // 20MB safety cap per file

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result || ""
      const comma = String(result).indexOf(",")
      resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function renderAttachmentChips() {
  if (!attachmentChips) return
  attachmentChips.innerHTML = ""
  if (pendingAttachments.length === 0) {
    attachmentChips.hidden = true
    attachButton?.classList.remove("has-files")
    return
  }
  attachmentChips.hidden = false
  attachButton?.classList.add("has-files")
  pendingAttachments.forEach((att, idx) => {
    const chip = document.createElement("div")
    chip.className = "attachment-chip"
    const isImage = att.mimeType.startsWith("image/")
    if (isImage && att.url) {
      const img = document.createElement("img")
      img.className = "chip-thumb"
      img.src = att.url
      img.alt = att.name
      chip.appendChild(img)
    } else {
      const icon = document.createElement("i")
      icon.className = "chip-icon ph ph-file"
      chip.appendChild(icon)
    }
    const name = document.createElement("span")
    name.className = "chip-name"
    name.textContent = att.name
    name.title = `${att.name} (${Math.round(att.size / 1024)} KB)`
    chip.appendChild(name)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "chip-remove"
    remove.setAttribute("aria-label", `Remove ${att.name}`)
    remove.innerHTML = '<i class="ph ph-x"></i>'
    remove.addEventListener("click", () => {
      if (att.url) URL.revokeObjectURL(att.url)
      pendingAttachments.splice(idx, 1)
      renderAttachmentChips()
    })
    chip.appendChild(remove)
    attachmentChips.appendChild(chip)
  })
}

function clearAttachments() {
  pendingAttachments.forEach(att => att.url && URL.revokeObjectURL(att.url))
  pendingAttachments.length = 0
  renderAttachmentChips()
  if (attachInput) attachInput.value = ""
}

async function handleAttachFiles(fileList) {
  const files = Array.from(fileList || [])
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      logMessage(`Attachment "${file.name}" exceeds 20MB limit and was skipped.`, "system")
      continue
    }
    try {
      const base64 = await fileToBase64(file)
      pendingAttachments.push({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })
    } catch (err) {
      Logger.error("Failed to read attachment:", err)
      logMessage(`Failed to read "${file.name}": ${err.message}`, "system")
    }
  }
  renderAttachmentChips()
}

attachButton?.addEventListener("click", () => attachInput?.click())
attachInput?.addEventListener("change", (e) => {
  handleAttachFiles(e.target.files)
})

// === Skills rail — true infinite loop ===
// Clone the chips multiple times and silently wrap the scroll position when
// the user gets near either end so they NEVER hit a boundary. This produces
// a seamless, endless horizontal scroll.
const SKILL_LOOP_COPIES = 4
document.querySelectorAll(".skills-row").forEach((row) => {
  const originals = Array.from(row.children)
  if (originals.length === 0) return
  for (let i = 0; i < SKILL_LOOP_COPIES - 1; i++) {
    originals.forEach((node) => row.appendChild(node.cloneNode(true)))
  }

  // One "copy" width = total scrollable / number of copies.
  const getCopyWidth = () => row.scrollWidth / SKILL_LOOP_COPIES

  // Park the scroll dead-center so the user has equal swipe room on both
  // sides — feels symmetric whether you flick left or right.
  requestAnimationFrame(() => {
    row.scrollLeft = (row.scrollWidth - row.clientWidth) / 2
  })

  // Silent wrap: when scroll drifts past the third copy, jump back by one
  // copy width; when it slips before the first, jump forward by one. The
  // visual content is identical at both positions so the user can't tell.
  let isWrapping = false
  row.addEventListener("scroll", () => {
    if (isWrapping) return
    const copy = getCopyWidth()
    if (!copy) return
    if (row.scrollLeft >= copy * (SKILL_LOOP_COPIES - 1)) {
      isWrapping = true
      row.scrollLeft -= copy
      requestAnimationFrame(() => { isWrapping = false })
    } else if (row.scrollLeft <= 0) {
      isWrapping = true
      row.scrollLeft += copy
      requestAnimationFrame(() => { isWrapping = false })
    }
  }, { passive: true })
})

// Event-delegated click handler so cloned chips work too.
document.querySelectorAll(".skills-row").forEach((row) => {
  row.addEventListener("click", async (e) => {
    const chip = e.target.closest(".skill-chip")
    if (!chip) return
    // Special chips open in-app screens instead of sending a prompt
    const skillName = chip.getAttribute("data-skill")
    if (skillName === "settings") {
      openSettings()
      return
    }
    if (skillName === "profile") {
      openProfile()
      return
    }
    const prompt = chip.getAttribute("data-prompt")
    if (!prompt) return
    if (!isConnected) {
      logMessage("Not connected. Tap Connect first.", "system")
      return
    }
    messageInput.value = prompt
    await handleSendMessage()
  })
})

// === Settings page ===
const settingsPanel = document.getElementById("settings-panel")
const settingsClose = document.getElementById("settings-close")
const settingsSave = document.getElementById("settings-save")
const settingUserName = document.getElementById("setting-user-name")
const settingAgentName = document.getElementById("setting-agent-name")
const settingPersona = document.getElementById("setting-persona")
const personaPresets = document.querySelectorAll(".persona-preset")
const kbUploadBtn = document.getElementById("kb-upload-btn")
const kbUploadInput = document.getElementById("kb-upload-input")
const kbList = document.getElementById("kb-list")

const PERSONA_PRESETS = {
  warm: "Warm, friendly, and encouraging. Speaks like a thoughtful close friend. Uses casual language with empathy. Keeps replies natural and conversational.",
  professional: "Professional, precise, and articulate. Maintains a formal but approachable tone. Focuses on clarity, accuracy, and structured answers.",
  playful: "Playful, witty, and a little cheeky. Light banter is fine. Quick on humor but never at the user's expense. Keeps energy high.",
  concise: "Concise and to the point. No filler, no preamble. Answers in the fewest words that fully address the question.",
}

const KB_STORAGE_KEY = "eburon_knowledge_base"
const SETTINGS_STORAGE_KEY = "eburon_settings"
let knowledgeBase = [] // [{ name, mimeType, size, base64, text }]

async function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      if (data.userName) settingUserName.value = data.userName
      if (data.agentName) settingAgentName.value = data.agentName
      if (data.persona) settingPersona.value = data.persona
    }
    
    // Load persona name and user name from localStorage with defaults
    const savedPersonaName = localStorage.getItem("persona_name")
    const savedUserName = localStorage.getItem("user_name")
    
    if (savedPersonaName && !settingAgentName.value) {
      settingAgentName.value = savedPersonaName
    } else if (!settingAgentName.value) {
      settingAgentName.value = CONFIG.PERSONA.DEFAULT_NAME
    }
    
    if (savedUserName && !settingUserName.value) {
      settingUserName.value = savedUserName
    } else if (!settingUserName.value) {
      settingUserName.value = CONFIG.PERSONA.DEFAULT_USER_NAME
    }
    
    const kbRaw = localStorage.getItem(KB_STORAGE_KEY)
    if (kbRaw) knowledgeBase = JSON.parse(kbRaw) || []
  } catch (err) {
    Logger.warn?.("Failed to load settings", err)
  }
  renderKbList()
}

function buildSystemInstruction() {
  const userName = settingUserName.value.trim() || localStorage.getItem("user_name") || CONFIG.PERSONA.DEFAULT_USER_NAME
  const agentName = settingAgentName.value.trim() || localStorage.getItem("persona_name") || CONFIG.PERSONA.DEFAULT_NAME
  const persona = settingPersona.value.trim()
  const parts = []
  if (agentName) parts.push(`Your name is ${agentName}.`)
  if (userName) parts.push(`The user prefers to be called ${userName}.`)
  if (persona) parts.push(`Behavior and tone: ${persona}`)
  
  // Add Google tools information
  if (CONFIG.GOOGLE_TOOLS?.ENABLED) {
    const toolDescriptions = CONFIG.GOOGLE_TOOLS.TOOLS.map(tool => 
      `- ${tool.name}: ${tool.description}`
    ).join("\n")
    parts.push(`You have access to the following Google API tools:\n\n${toolDescriptions}\n\nUse these tools when the user asks for help with emails, calendar, files, spreadsheets, presentations, tasks, or location. The tools are already configured with proper authentication.`)
  }
  
  // Add conversation context from localStorage
  const history = getConversationHistory()
  if (history.length > 0) {
    const recentConversations = history.slice(-5).map(h => `User: ${h.user}\nAssistant: ${h.assistant}`).join("\n\n")
    parts.push(`Here are some recent conversations for context:\n\n${recentConversations}\n\nUse this context to provide more personalized and relevant responses.`)
  }
  
  if (knowledgeBase.length > 0) {
    const kbText = knowledgeBase
      .filter((f) => f.text)
      .map((f) => `--- ${f.name} ---\n${f.text}`)
      .join("\n\n")
    if (kbText) {
      parts.push(`You have the following knowledge base provided by the user. Reference it when relevant:\n\n${kbText}`)
    } else {
      parts.push(`The user uploaded these files as reference: ${knowledgeBase.map((f) => f.name).join(", ")}.`)
    }
  }
  // Preserve any base instruction the app already had
  const base = CONFIG.SYSTEM_INSTRUCTION.TEXT && !CONFIG.SYSTEM_INSTRUCTION.TEXT.startsWith("[USER_PERSONA]")
    ? CONFIG.SYSTEM_INSTRUCTION.TEXT
    : ""
  return [base, parts.length ? `[USER_PERSONA]\n${parts.join("\n\n")}` : ""].filter(Boolean).join("\n\n")
}

async function saveSettings() {
  const data = {
    userName: settingUserName.value.trim(),
    agentName: settingAgentName.value.trim(),
    persona: settingPersona.value.trim(),
  }
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))
  localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(knowledgeBase))
  
  // Save persona name and user name separately for easy access
  localStorage.setItem("persona_name", settingAgentName.value.trim() || CONFIG.PERSONA.DEFAULT_NAME)
  localStorage.setItem("user_name", settingUserName.value.trim() || CONFIG.PERSONA.DEFAULT_USER_NAME)

  // Push the composed instruction into the live config + the legacy textarea
  const composed = buildSystemInstruction()
  CONFIG.SYSTEM_INSTRUCTION.TEXT = composed
  systemInstructionInput.value = composed
  localStorage.setItem("gemini_system_instruction", composed)

  // Briefly flash the save button green
  settingsSave.classList.add("saved")
  settingsSave.textContent = "Saved"
  setTimeout(() => {
    settingsSave.classList.remove("saved")
    settingsSave.textContent = "Save"
  }, 1400)

  // If we're connected, reconnect to apply the new instruction
  if (isConnected) {
    logMessage("Applying new persona — reconnecting...", "system")
    await disconnectFromWebsocket()
    await connectToWebsocket()
  }
}

function openSettings() {
  settingsPanel.classList.add("open")
  settingsPanel.setAttribute("aria-hidden", "false")
}

function closeSettings() {
  settingsPanel.classList.remove("open")
  settingsPanel.setAttribute("aria-hidden", "true")
}

settingsClose?.addEventListener("click", closeSettings)
settingsSave?.addEventListener("click", saveSettings)

personaPresets.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-persona")
    const preset = PERSONA_PRESETS[key]
    if (preset) {
      settingPersona.value = preset
      personaPresets.forEach((b) => b.classList.remove("active"))
      btn.classList.add("active")
    }
  })
})

// === Knowledge base upload ===
function renderKbList() {
  if (!kbList) return
  kbList.innerHTML = ""
  if (knowledgeBase.length === 0) {
    const empty = document.createElement("div")
    empty.className = "kb-empty"
    empty.textContent = "No files uploaded yet."
    kbList.appendChild(empty)
    return
  }
  knowledgeBase.forEach((file, idx) => {
    const item = document.createElement("div")
    item.className = "kb-item"
    item.innerHTML = `
      <span class="kb-item-icon"><i class="ph-fill ph-file-text"></i></span>
      <div class="kb-item-info">
        <span class="kb-item-name">${file.name}</span>
        <span class="kb-item-meta">${Math.round(file.size / 1024)} KB${file.text ? " · indexed" : ""}</span>
      </div>
      <button class="kb-item-remove" aria-label="Remove ${file.name}"><i class="ph ph-x"></i></button>
    `
    item.querySelector(".kb-item-remove").addEventListener("click", () => {
      knowledgeBase.splice(idx, 1)
      localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(knowledgeBase))
      renderKbList()
    })
    kbList.appendChild(item)
  })
}

const KB_MAX_BYTES = 10 * 1024 * 1024
const KB_TEXT_TYPES = /^(text\/|application\/json$|application\/x-yaml$)/

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || "")
      const comma = result.indexOf(",")
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

kbUploadBtn?.addEventListener("click", () => kbUploadInput?.click())
kbUploadInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || [])
  for (const file of files) {
    if (file.size > KB_MAX_BYTES) {
      logMessage(`"${file.name}" exceeds 10MB limit and was skipped.`, "system")
      continue
    }
    const isText = KB_TEXT_TYPES.test(file.type) || /\.(txt|md|json|csv|yaml|yml)$/i.test(file.name)
    try {
      const entry = {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64: await readFileAsBase64(file),
      }
      // For text-based formats, also extract content so it can be inlined
      // into the system instruction as actual referenceable knowledge.
      if (isText) entry.text = await readFileAsText(file)
      knowledgeBase.push(entry)
    } catch (err) {
      Logger.error("KB upload failed:", err)
    }
  }
  localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(knowledgeBase))
  renderKbList()
  e.target.value = ""
})

// Load on startup and rebuild instruction so persona is active even before
// the user opens settings on a returning session.
loadSettings()
{
  const composed = buildSystemInstruction()
  if (composed) {
    CONFIG.SYSTEM_INSTRUCTION.TEXT = composed
    systemInstructionInput.value = composed
  }
}

/**
 * Event listeners for sending messages.
 */
sendButton.addEventListener("click", async () => {
  await handleSendMessage()
})
messageInput.addEventListener("keypress", async (event) => {
  if (event.key === "Enter") {
    await handleSendMessage()
  }
})

/**
 * On turn completion, save the conversation turn (user and assistant messages) to Mem0.
 */
client.on("turncomplete", async () => {
  isUsingTool = false
  logMessage("Turn complete", "system")
  
  // Finalize the current streaming message
  if (currentStreamingMessage) {
    finalizeStreamingMessage(currentStreamingMessage)
    currentStreamingMessage = null
  }

  // Finalize user transcript bubble for this turn
  if (currentUserTranscript) {
    finalizeStreamingMessage(currentUserTranscript)
    if (userTranscriptText && !lastUserMessage) {
      lastUserMessage = userTranscriptText
    }
    currentUserTranscript = null
  }
  // Prefer the spoken AI transcript over the raw modelTurn text for memory,
  // so saved memories match what the user actually heard.
  if (outputTranscriptText) {
    lastAssistantMessage = outputTranscriptText
  }
  userTranscriptText = ""
  outputTranscriptText = ""

  // User messages are already rendered immediately when sent.
  if (lastUserMessage && lastAssistantMessage) {
    // Save to localStorage (edge storage)
    saveConversationToHistory(lastUserMessage, lastAssistantMessage)
    
    if (CONFIG.PERFORMANCE?.ENABLE_MEMORY === true) {
      const userMessageToSave = lastUserMessage
      const assistantMessageToSave = lastAssistantMessage
      addMemory("default", [
        { role: "user", content: userMessageToSave },
        { role: "assistant", content: assistantMessageToSave },
      ]).catch((error) => Logger.error("Error saving conversation to memory:", error))
    }
    lastUserMessage = ""
    lastAssistantMessage = ""
  }
})

/**
 * Accumulates assistant reply text and displays it in conversation.
 */
client.on("content", (data) => {
  if (data.modelTurn) {
    if (data.modelTurn.parts.some((part) => part.functionCall)) {
      isUsingTool = true
      Logger.info("Model is using a tool")
    } else if (data.modelTurn.parts.some((part) => part.functionResponse)) {
      isUsingTool = false
      Logger.info("Tool usage completed")
    }
    const rawText = data.modelTurn.parts.map((part) => part.text).join("")
    const cleanedText = cleanAIResponse(rawText)
    if (cleanedText) {
      // Keep the full structured text in the system log + memory pipeline,
      // but DO NOT render it into the chat bubble — the chat shows only what
      // the AI actually speaks aloud (driven by outputAudioTranscription).
      logMessage(cleanedText, "ai")
      lastAssistantMessage = cleanedText
    }
  }
})

// === Live transcription rendering ===
// User mic transcript -> a streaming user bubble.
// AI output transcript -> appended into the current AI streaming bubble (used as
// captions when responseModalities is "audio" only).
let currentUserTranscript = null
let userTranscriptText = ""
let outputTranscriptText = ""

client.on("inputtranscription", (payload) => {
  const delta = payload?.text || ""
  if (!delta) return
  userTranscriptText += delta
  if (!currentUserTranscript) {
    currentUserTranscript = addStreamingMessage("", "user")
  }
  updateStreamingMessage(currentUserTranscript, userTranscriptText)
})

client.on("outputtranscription", (payload) => {
  const delta = payload?.text || ""
  if (!delta) return
  outputTranscriptText += delta
  // The AI bubble shows ONLY what the model actually says out loud —
  // structured/wrapped text from modelTurn is intentionally ignored here.
  if (!currentStreamingMessage) {
    currentStreamingMessage = addStreamingMessage("")
  }
  updateStreamingMessage(currentStreamingMessage, outputTranscriptText)
})

client.on("open", () => {
  logMessage("WebSocket connection opened", "system")
})
client.on("log", (log) => {
  logMessage(`${log.type}: ${JSON.stringify(log.message)}`, "system")
})
client.on("close", (event) => {
  logMessage(`WebSocket connection closed (code ${event.code})`, "system")
})
client.on("audio", async (data) => {
  try {
    const streamer = await ensureAudioInitialized()
    streamer.addPCM16(new Uint8Array(data))
    // analyser-driven loop will animate the bars from the actual playback signal
  } catch (error) {
    logMessage(`Error processing audio: ${error.message}`, "system")
  }
})
client.on("interrupted", () => {
  audioStreamer?.stop()
  isUsingTool = false
  Logger.info("Model interrupted")
  logMessage("Model interrupted", "system")
  
  // Finalize streaming message on interruption
  if (currentStreamingMessage) {
    finalizeStreamingMessage(currentStreamingMessage)
    currentStreamingMessage = null
  }
  if (currentUserTranscript) {
    finalizeStreamingMessage(currentUserTranscript)
    currentUserTranscript = null
  }
  userTranscriptText = ""
  outputTranscriptText = ""
})
client.on("setupcomplete", () => {
  logMessage("Setup complete", "system")
})
client.on("error", (error) => {
  if (error instanceof ApplicationError) {
    Logger.error(`Application error: ${error.message}`, error)
  } else {
    Logger.error("Unexpected error", error)
  }
  logMessage(`Error: ${error.message}`, "system")
})
client.on("message", (message) => {
  if (message.error) {
    Logger.error("Server error:", message.error)
    logMessage(`Server error: ${message.error}`, "system")
  }
})

micButton.addEventListener("click", handleMicToggle)
connectButton.addEventListener("click", () => {
  if (isConnected) {
    disconnectFromWebsocket()
  } else {
    connectToWebsocket()
  }
})
messageInput.disabled = true
sendButton.disabled = true
micButton.disabled = true
setConnectButtonLabel("Connect", false)

/**
 * Handles the video toggle. Starts or stops video streaming.
 */
async function handleVideoToggle() {
  Logger.info("Video toggle clicked, current state:", { isVideoActive, isConnected })
  if (!isVideoActive) {
    try {
      Logger.info("Attempting to start video")
      if (isScreenSharing) stopScreenSharing()
      if (!videoManager) {
        videoManager = new VideoManager()
      }
      await videoManager.start((frameData) => {
        if (isConnected) {
          client.sendRealtimeInput([frameData])
        }
      })
      isVideoActive = true
      cameraIcon.className = "ph-fill ph-video-camera"
      cameraButton.classList.add("active-cam")
      screenButton.classList.remove("active-screen")
      setMediaLayerState("camera")
      pipWindow.style.display = "none"
      // Show flip camera button
      flipCameraButton.classList.remove("hidden")
      Logger.info("Camera started successfully")
      logMessage("Camera started", "system")
    } catch (error) {
      Logger.error("Camera error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isVideoActive = false
      videoManager = null
      cameraIcon.className = "ph ph-video-camera"
      cameraButton.classList.remove("active-cam")
      setMediaLayerState(null)
    }
  } else {
    Logger.info("Stopping video")
    stopVideo()
  }
}

/**
 * Stops the video streaming.
 */
function stopVideo() {
  if (videoManager) {
    videoManager.stop()
    videoManager = null
  }
  isVideoActive = false
  cameraIcon.className = "ph ph-video-camera"
  cameraButton.classList.remove("active-cam")
  setMediaLayerState(isScreenSharing ? "screen" : null)
  // Hide flip camera button
  flipCameraButton.classList.add("hidden")
  logMessage("Camera stopped", "system")
}

/**
 * Handles flipping between front and back cameras.
 */
async function handleCameraFlip() {
  if (!videoManager || !isVideoActive) {
    Logger.warn("Cannot flip camera: video not active")
    return
  }

  try {
    Logger.info("Flipping camera")
    await videoManager.flipCamera()
    logMessage("Camera flipped", "system")
  } catch (error) {
    Logger.error("Camera flip error:", error)
    logMessage(`Error flipping camera: ${error.message}`, "system")
  }
}

cameraButton.addEventListener("click", handleVideoToggle)
flipCameraButton.addEventListener("click", handleCameraFlip)
stopVideoButton.addEventListener("click", stopVideo)
cameraButton.disabled = true

/**
 * Handles the screen share toggle. Starts or stops screen sharing.
 */
async function handleScreenShare() {
  if (!isScreenSharing) {
    try {
      if (isVideoActive) stopVideo()
      screenContainer.style.display = "block"
      screenRecorder = new ScreenRecorder()
      await screenRecorder.start(screenPreview, (frameData) => {
        if (isConnected) {
          client.sendRealtimeInput([
            {
              mimeType: "image/jpeg",
              data: frameData,
            },
          ])
        }
      })
      isScreenSharing = true
      screenIcon.className = "ph-fill ph-screencast"
      screenButton.classList.add("active-screen")
      cameraButton.classList.remove("active-cam")
      cameraIcon.className = "ph ph-video-camera"
      setMediaLayerState("screen")
      Logger.info("Screen sharing started")
      logMessage("Screen sharing started", "system")
    } catch (error) {
      Logger.error("Screen sharing error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isScreenSharing = false
      screenIcon.className = "ph ph-screencast"
      screenButton.classList.remove("active-screen")
      setMediaLayerState(null)
      screenContainer.style.display = "none"
    }
  } else {
    stopScreenSharing()
  }
}

/**
 * Stops the screen sharing.
 */
function stopScreenSharing() {
  if (screenRecorder) {
    screenRecorder.stop()
    screenRecorder = null
  }
  isScreenSharing = false
  screenIcon.className = "ph ph-screencast"
  screenButton.classList.remove("active-screen")
  setMediaLayerState(isVideoActive ? "camera" : null)
  screenContainer.style.display = "none"
  logMessage("Screen sharing stopped", "system")
}

screenButton.addEventListener("click", handleScreenShare)
screenButton.disabled = true


// ============================================================
// === Authentication (Firebase) ==============================
// ============================================================
const authScreen = document.getElementById("auth-screen")
const authForm = document.getElementById("auth-form")
const authNameInput = document.getElementById("auth-name")
const authEmailInput = document.getElementById("auth-email")
const authPasswordInput = document.getElementById("auth-password")
const authSubmitBtn = document.getElementById("auth-submit")
const authSubmitText = authSubmitBtn?.querySelector(".auth-submit-text")
const authGoogleBtn = document.getElementById("auth-google")
const authToggleBtn = document.getElementById("auth-toggle-mode")
const authForgotBtn = document.getElementById("auth-forgot")
const authErrorEl = document.getElementById("auth-error")
const authSubtitle = document.getElementById("auth-subtitle")

let authMode = "signin" // or "signup"
let currentUser = null

function setAuthMode(mode) {
  authMode = mode
  if (mode === "signup") {
    authScreen.classList.add("signup-mode")
    authSubtitle.textContent = "Create your account"
    authSubmitText.textContent = "Sign up"
    authToggleBtn.innerHTML = `Already have an account? <strong>Sign in</strong>`
    authPasswordInput.setAttribute("autocomplete", "new-password")
  } else {
    authScreen.classList.remove("signup-mode")
    authSubtitle.textContent = "Sign in to start automating"
    authSubmitText.textContent = "Sign in"
    authToggleBtn.innerHTML = `Don't have an account? <strong>Sign up</strong>`
    authPasswordInput.setAttribute("autocomplete", "current-password")
  }
  setAuthError("")
}

function setAuthError(msg, success = false) {
  if (!authErrorEl) return
  authErrorEl.textContent = msg || ""
  authErrorEl.classList.toggle("success", !!success && !!msg)
}

function prettyAuthError(err) {
  const code = err?.code || ""
  const map = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in cancelled.",
    "auth/network-request-failed": "Network error. Check your connection.",
  }
  return map[code] || err?.message || "Something went wrong. Try again."
}

authToggleBtn?.addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin")
})

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault()
  const email = authEmailInput.value.trim()
  const password = authPasswordInput.value
  if (!email || !password) {
    setAuthError("Please enter your email and password.")
    return
  }
  authSubmitBtn.disabled = true
  setAuthError("")
  try {
    if (authMode === "signup") {
      const name = authNameInput.value.trim()
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (name) await updateProfile(cred.user, { displayName: name })
      // Seed profile in DB
      await set(ref(db, `users/${cred.user.uid}`), {
        email: cred.user.email,
        displayName: name || "",
        createdAt: Date.now(),
      })
    } else {
      await signInWithEmailAndPassword(auth, email, password)
    }
  } catch (err) {
    setAuthError(prettyAuthError(err))
  } finally {
    authSubmitBtn.disabled = false
  }
})

authGoogleBtn?.addEventListener("click", async () => {
  setAuthError("")
  try {
    const cred = await signInWithPopup(auth, googleProvider)
    
    // Get OAuth access token for Google API tools
    const token = await cred.user.getIdToken()
    if (client && client.setGoogleAccessToken) {
      client.setGoogleAccessToken(token)
      logMessage("Google API tools enabled", "system")
    }
    
    // Seed/merge profile
    const userRef = ref(db, `users/${cred.user.uid}`)
    const snap = await get(userRef)
    if (!snap.exists()) {
      await set(userRef, {
        email: cred.user.email,
        displayName: cred.user.displayName || "",
        photoURL: cred.user.photoURL || "",
        createdAt: Date.now(),
      })
    }
  } catch (err) {
    setAuthError(prettyAuthError(err))
  }
})

authForgotBtn?.addEventListener("click", async () => {
  const email = authEmailInput.value.trim()
  if (!email) {
    setAuthError("Enter your email above first.")
    return
  }
  try {
    await sendPasswordResetEmail(auth, email)
    setAuthError("Reset link sent. Check your inbox.", true)
  } catch (err) {
    setAuthError(prettyAuthError(err))
  }
})

// ============================================================
// === Profile Page ===========================================
// ============================================================
const profilePanel = document.getElementById("profile-panel")
const profileClose = document.getElementById("profile-close")
const profileSave = document.getElementById("profile-save")
const profileAvatar = document.getElementById("profile-avatar")
const profileAvatarEdit = document.getElementById("profile-avatar-edit")
const profileAvatarInput = document.getElementById("profile-avatar-input")
const profileDisplayNameLabel = document.getElementById("profile-display-name")
const profileEmailDisplay = document.getElementById("profile-email-display")
const profileNameInput = document.getElementById("profile-name")
const profileEmailInput = document.getElementById("profile-email")
const profileBirthdayInput = document.getElementById("profile-birthday")
const profileBioInput = document.getElementById("profile-bio")
const profileInterestInput = document.getElementById("profile-interest-input")
const profileInterestsContainer = document.getElementById("profile-interests")
const profileSignoutBtn = document.getElementById("profile-signout")

let profileData = {
  displayName: "",
  email: "",
  birthday: "",
  bio: "",
  interests: [],
  photoURL: "",
}

const FALLBACK_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%236366F1'/%3E%3Cstop offset='1' stop-color='%238B5CF6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='96' height='96' fill='url(%23g)'/%3E%3Ccircle cx='48' cy='38' r='16' fill='white' fill-opacity='0.85'/%3E%3Cpath d='M16 88 c0 -20 14 -32 32 -32 s32 12 32 32' fill='white' fill-opacity='0.85'/%3E%3C/svg%3E"

function renderInterests() {
  if (!profileInterestsContainer) return
  profileInterestsContainer.innerHTML = ""
  profileData.interests.forEach((interest, idx) => {
    const chip = document.createElement("span")
    chip.className = "interest-chip"
    chip.innerHTML = `${interest}<button aria-label="Remove ${interest}"><i class="ph ph-x"></i></button>`
    chip.querySelector("button").addEventListener("click", () => {
      profileData.interests.splice(idx, 1)
      renderInterests()
    })
    profileInterestsContainer.appendChild(chip)
  })
}

function fillProfileUI() {
  profileNameInput.value = profileData.displayName || ""
  profileEmailInput.value = profileData.email || ""
  profileBirthdayInput.value = profileData.birthday || ""
  profileBioInput.value = profileData.bio || ""
  profileAvatar.src = profileData.photoURL || FALLBACK_AVATAR
  profileDisplayNameLabel.textContent = profileData.displayName || "—"
  profileEmailDisplay.textContent = profileData.email || ""
  renderInterests()
}

async function loadProfile(user) {
  if (!user) return
  profileData.email = user.email || ""
  profileData.displayName = user.displayName || ""
  profileData.photoURL = user.photoURL || ""
  try {
    const snap = await get(ref(db, `users/${user.uid}`))
    if (snap.exists()) {
      const v = snap.val() || {}
      profileData = {
        displayName: v.displayName || profileData.displayName,
        email: v.email || profileData.email,
        birthday: v.birthday || "",
        bio: v.bio || "",
        interests: Array.isArray(v.interests) ? v.interests : [],
        photoURL: v.photoURL || profileData.photoURL,
      }
    }
  } catch (err) {
    Logger.warn?.("Failed to load profile", err)
  }
  fillProfileUI()
}

async function saveProfile() {
  if (!currentUser) return
  profileData.displayName = profileNameInput.value.trim()
  profileData.birthday = profileBirthdayInput.value
  profileData.bio = profileBioInput.value.trim()
  try {
    await update(ref(db, `users/${currentUser.uid}`), {
      displayName: profileData.displayName,
      birthday: profileData.birthday,
      bio: profileData.bio,
      interests: profileData.interests,
      photoURL: profileData.photoURL,
      email: profileData.email,
      updatedAt: Date.now(),
    })
    if (profileData.displayName !== currentUser.displayName) {
      await updateProfile(currentUser, { displayName: profileData.displayName })
    }
    profileSave.classList.add("saved")
    profileSave.textContent = "Saved"
    setTimeout(() => {
      profileSave.classList.remove("saved")
      profileSave.textContent = "Save"
    }, 1400)
    fillProfileUI()
  } catch (err) {
    Logger.error("Profile save failed", err)
    logMessage(`Profile save failed: ${err.message}`, "system")
  }
}

function openProfile() {
  profilePanel.classList.add("open")
  profilePanel.setAttribute("aria-hidden", "false")
}
function closeProfile() {
  profilePanel.classList.remove("open")
  profilePanel.setAttribute("aria-hidden", "true")
}

profileClose?.addEventListener("click", closeProfile)
profileSave?.addEventListener("click", saveProfile)

// Avatar upload — store as base64 (downscaled) in Firebase RTDB
profileAvatarEdit?.addEventListener("click", () => profileAvatarInput?.click())
profileAvatarInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  
  // Validate file type
  if (!file.type.startsWith('image/')) {
    logMessage('Please select an image file', 'system')
    return
  }
  
  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    logMessage('Image must be less than 5MB', 'system')
    return
  }
  
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    // Downscale to 256px square to keep DB payload small
    const img = new Image()
    img.src = dataUrl
    await new Promise((res) => { img.onload = res })
    const size = 256
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    profileData.photoURL = canvas.toDataURL("image/jpeg", 0.85)
    profileAvatar.src = profileData.photoURL
    logMessage('Avatar updated - click Save to save to Firebase RTDB', 'system')
  } catch (err) {
    Logger.error("Avatar processing failed", err)
    logMessage('Failed to process avatar image', 'system')
  }
  e.target.value = ""
})

// Add interests on Enter
profileInterestInput?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return
  e.preventDefault()
  const value = profileInterestInput.value.trim()
  if (!value) return
  if (!profileData.interests.includes(value)) {
    profileData.interests.push(value)
    renderInterests()
  }
  profileInterestInput.value = ""
})

profileSignoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth)
  } catch (err) {
    Logger.error("Sign out failed", err)
  }
})

// ============================================================
// === PWA Install Banner =====================================
// ============================================================
let deferredPrompt = null
const pwaInstallBanner = document.getElementById('pwa-install-banner')
const pwaInstallDismiss = document.getElementById('pwa-install-dismiss')
const pwaInstallConfirm = document.getElementById('pwa-install-confirm')

// Check if user has already dismissed or installed
const pwaInstallDismissed = localStorage.getItem('pwa_install_dismissed')
const pwaInstalled = localStorage.getItem('pwa_installed')

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        Logger.info('Service Worker registered:', registration)
      })
      .catch(error => {
        Logger.error('Service Worker registration failed:', error)
      })
  })
}

// Listen for beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  
  // Show banner if not dismissed and not installed
  if (!pwaInstallDismissed && !pwaInstalled && pwaInstallBanner) {
    pwaInstallBanner.classList.remove('hidden')
  }
})

// Handle install button click
pwaInstallConfirm?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    
    if (outcome === 'accepted') {
      localStorage.setItem('pwa_installed', 'true')
      Logger.info('PWA installed')
    }
  }
  
  if (pwaInstallBanner) {
    pwaInstallBanner.classList.add('hidden')
  }
})

// Handle dismiss button click
pwaInstallDismiss?.addEventListener('click', () => {
  localStorage.setItem('pwa_install_dismissed', 'true')
  if (pwaInstallBanner) {
    pwaInstallBanner.classList.add('hidden')
  }
})

// Listen for app installed event
window.addEventListener('appinstalled', () => {
  localStorage.setItem('pwa_installed', 'true')
  if (pwaInstallBanner) {
    pwaInstallBanner.classList.add('hidden')
  }
  Logger.info('PWA app installed')
})

// ============================================================
// === Auth state lifecycle ===================================
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user
    authScreen.classList.add("hidden-screen")
    authScreen.setAttribute("aria-hidden", "true")
    await loadProfile(user)
    
    // Load persona names from localStorage or use defaults
    const savedPersonaName = localStorage.getItem("persona_name") || CONFIG.PERSONA.DEFAULT_NAME
    const savedUserName = localStorage.getItem("user_name") || CONFIG.PERSONA.DEFAULT_USER_NAME
    
    // Inject the user's name into the system instruction so the agent uses it
    if (profileData.displayName && !settingUserName.value) {
      settingUserName.value = profileData.displayName
      const composed = buildSystemInstruction()
      CONFIG.SYSTEM_INSTRUCTION.TEXT = composed
      systemInstructionInput.value = composed
    }
    
    // Display opening message based on conversation history
    const openingMessage = generateOpeningMessageFromHistory()
    addConversationMessage(openingMessage, "ai")
  } else {
    currentUser = null
    closeProfile()
    closeSettings()
    authScreen.classList.remove("hidden-screen")
    authScreen.setAttribute("aria-hidden", "false")
    setAuthMode("signin")
    // Clean up websocket if any
    if (isConnected) await disconnectFromWebsocket()
  }
})
