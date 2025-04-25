import { CreateMLCEngine } from "@mlc-ai/web-llm";

const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC";
let engine = null;
let engineLoaded = false;

export async function initializeEngine() {
  const initProgressCallback = (initProgress) => {
    console.log(initProgress);
  }
  engine = await CreateMLCEngine(
    selectedModel,
    { initProgressCallback: initProgressCallback },
  );
  engineLoaded = true;
}

export function getEngine() {
  return engine;
}

export function isEngineLoaded() {
  return engineLoaded;
}
