import { CreateMLCEngine } from "@mlc-ai/web-llm";

// const selectedModel = "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k";
// const selectedModel = "TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC-1k";
const selectedModel = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

let engine = null;
let engineLoaded = false;
let downloadProgress = 0;

export async function initializeEngine() {
  const initProgressCallback = (initProgress) => {
    console.log(initProgress);

    const match = initProgress.text.match(/(\d+)%/);
    if (match) {
      downloadProgress = parseInt(match[1], 10);
    }
  }
  engine = await CreateMLCEngine(
    selectedModel,
    { initProgressCallback: initProgressCallback },
  );
  downloadProgress = 100;
  engineLoaded = true;
}

export function getDownloadProgress() {
  return downloadProgress;
}

export function getEngine() {
  return engine;
}

export function isEngineLoaded() {
  return engineLoaded;
}
