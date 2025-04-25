<template>
  <div>
    <button @click="showModal = true">How to Play</button>

    <div v-if="showModal" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div v-if="!hasWebGPU" class="gpu-message">
          This game requires WebGPU enabled. Please use a browser that supports WebGPU. Avoid mobile browsers for perfomance reasons.
        </div>
        <div v-else-if="isMobile" class="mobile-message">
          You appear to be visiting on mobile. This game is best experienced on desktop.
          Expect performance issues.
        </div>
        <h2>How to Play</h2>
        <p>
          Welcome to Llamadle!
          The goal of the game is to prompt the LLM to guess the secret phrase.
          Try to reach the phrase in the fewest tokens possible!
        </p>
        <div v-if="!engineLoaded">
          <p>
            LLM is downloading. This will be faster on subsequent visits.
          </p>
          Download Progress: {{ downloadProgress }}%
        </div>
        <button :disabled="!engineLoaded || !hasWebGPU" @click="closeModal">Close</button>
      </div>
    </div>
  </div>
</template>

<script>
import { getDownloadProgress, isEngineLoaded } from '../engine';

export default {
  name: "HelpModal",
  data() {
    return {
      showModal: true,
      downloadProgress: 0,
      engineLoaded: false,
      isMobile: false,
      hasWebGPU: false,
    };
  },
  mounted() {
    this.isMobile = /Mobi|Android/i.test(navigator.userAgent);
    this.hasWebGPU = !!navigator.gpu;
    this.updateProgress();
  },
  methods: {
    closeModal() {
      if (this.engineLoaded  || this.hasWebGPU) {
        this.showModal = false;
      }
    },
    updateProgress() {
      const interval = setInterval(() => {
        this.downloadProgress = getDownloadProgress();
        this.engineLoaded = isEngineLoaded();
        if (this.engineLoaded) {
          clearInterval(interval);
        }
      }, 500);
    },
  },
};
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
}

.mobile-message {
  background-color: #ffeb3b;
  color: #000;
  padding: 10px;
  margin-bottom: 20px;
  border-radius: 5px;
  font-weight: bold;
}

.gpu-message {
  background-color: #ffcc00;
  color: #000;
  padding: 10px;
  margin-bottom: 20px;
  border-radius: 5px;
  font-weight: bold;
}

.modal-content {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  max-width: 500px;
  width: 100%;
}

button {
  background-color: #4CAF50;
  color: white;
  border: none;
  padding: 10px 20px;
  text-align: center;
  text-decoration: none;
  display: inline-block;
  font-size: 16px;
  margin: 4px 2px;
  cursor: pointer;
  border-radius: 4px;
}

button:disabled {
  background-color: #cccccc;
  color: #666666;
  cursor: not-allowed;
}
</style>
