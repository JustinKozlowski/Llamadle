<template>
  <div class="chat-app">
    <h1 class="chat-title">Llamadle</h1>
    <div class="target-phrase-banner">
      Target Phrase: "{{ phrase.phrase }}"
    </div>
    <div class="chat-window">
      <div class="chat-messages">
        <div
          v-for="(message, index) in messages.slice(0)"
          :key="index"
          :class="['chat-message', message.role]"
        >
          <p class="message-content">{{ message.content }}</p>
        </div>
      </div>
      <div v-if="warningMessage" class="warning-banner">
        {{ warningMessage }}
      </div>
      <div v-if="winner" class="winner-banner">
        🎉 Congratulations! You found the phrase: "{{ phrase.phrase }}" 🎉
        <button @click="loadNextPhrase">Next</button>
      </div>
      <div v-else class="chat-input">
        <textarea
          v-model="prompt"
          placeholder="Type your message..."
          rows="2"
          :disabled="loading"
          @keydown.enter.prevent="askPrompt"
        ></textarea>
        <button @click="askPrompt" :disabled="loading || !prompt.trim()">
          {{ loading ? "Loading..." : "Send" }}
        </button>
      </div>
      <div class="footer-section">
        <div class="difficulty-dropdown">
          <select id="difficulty" v-model="selectedDifficulty" @change="updateDifficulty">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div class="token-count">
          <p>Total Tokens: {{ tokenCount > 0 ? tokenCount : 0 }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getEngine, isEngineLoaded } from "../engine";
import { toRaw } from "vue";
import { getPhrases } from "../phrases";

export default {
  name: "WebLLMComponent",
  data() {
    return {
      prompt: "",
      messages: [],
      loading: false,
      phrase: getPhrases()[0],
      bannedWords: getPhrases()[0].difficulty[this.selectedDifficulty],
      // bannedWords: ['bird', 'worm'],
      winner: false,
      tokenCount: -10, // required due to base prompts submitted to the LLM
      preprocessed: false,
      warningMessage: "",
      selectedDifficulty: "medium",
    };
  },
  methods: {
    checkForWinner(response, phrase) {
      console.log(phrase);
      console.log(response);
      return response.toLowerCase().includes(phrase.toLowerCase());
    },
    makeWinner() {
      this.winner = true;
    },
    containsBannedWords(input) {
      console.log(this.bannedWords);
      console.log(this.phrase);
      console.log(this.selecteddifficulty);
      return this.bannedWords.find((word) => input.toLowerCase().includes(word.toLowerCase()));
    },
    async askPrompt() {
      this.winner = false;
      this.warningMessage = "";
      if (!isEngineLoaded()) {
        this.warningMessage = "Model is not loaded yet. Please wait.";
        return;
      }
      if (!this.prompt.trim()) {
        this.warningMessage = "Please enter a prompt.";
        return;
      }
      const bannedWord = this.containsBannedWords(this.prompt);
      if (bannedWord) {
        this.warningMessage = `Your prompt contains a banned word: "${bannedWord}". Please revise it.`;
        return;
      }

      try {
        this.loading = true;
        const userMessage = { role: "user", content: toRaw(this.prompt) };
        this.messages.push(userMessage);

        const local_messages = [
          { role: "system", content: "Respond in 1 sentence" },
          ...toRaw(this.messages),
        ];

        const result = await getEngine().chat.completions.create({ messages: local_messages });
        // reduce some base tokens. That way it punishes multiple messages
        this.tokenCount += result.usage.prompt_tokens - 5;
        const response = result.choices[0].message.content;

        const aiMessage = { role: "assistant", content: response };
        this.messages.push(aiMessage);

        if (this.checkForWinner(response, this.phrase.phrase)) {
          this.makeWinner();
        }
      } finally {
        this.loading = false;
        this.prompt = "";
        this.$nextTick(() => {
          const textarea = this.$el.querySelector('textarea');
          if (textarea) textarea.focus();
        });
      }
    },
    updateDifficulty() {
      this.bannedWords = this.phrase.difficulty[this.selectedDifficulty];
      this.winner = false;
      this.messages = [];
      this.tokenCount = -10; // Reset token count for the new phrase
    },
    loadNextPhrase() {
      const phrases = getPhrases();
      const currentIndex = phrases.findIndex(p => p.phrase === this.phrase.phrase);
      const nextIndex = (currentIndex + 1) % phrases.length;
      this.phrase = phrases[nextIndex];
      this.updateDifficulty();
      this.winner = false;
      this.messages = [];
      this.tokenCount = -10; // Reset token count for the new phrase
    },
    scrollToBottom() {
      this.$nextTick(() => {
        const chatMessages = this.$el.querySelector('.chat-messages');
        if (chatMessages) {
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      });
    },
  },
  mounted() {
    this.updateDifficulty();
    this.scrollToBottom();
  },
  updated() {
    this.scrollToBottom();
  },
};
</script>

<style scoped>
.chat-app {
  font-family: Arial, sans-serif;
  max-width: 600px;
  margin: 20px auto;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.target-phrase-banner {
  background-color: #ff9800;
  color: white;
  text-align: center;
  padding: 10px;
  font-weight: bold;
  border-bottom: 1px solid #ddd;
}

.chat-title {
  background-color: #4caf50;
  color: white;
  padding: 10px;
  text-align: center;
  margin: 0;
}

.chat-window {
  display: flex;
  flex-direction: column;
  height: 500px;
  background-color: #f9f9f9;
}

.chat-messages {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-message {
  max-width: 70%;
  padding: 10px;
  border-radius: 8px;
  word-wrap: break-word;
}

.chat-message.user {
  align-self: flex-end;
  background-color: #d1e7dd;
  color: #0f5132;
}

.chat-message.assistant {
  align-self: flex-start;
  background-color: #e2e3e5;
  color: #41464b;
}

.message-content {
  margin: 0;
}

.chat-input {
  display: flex;
  gap: 10px;
  padding: 10px;
  background-color: #fff;
  border-top: 1px solid #ddd;
}

textarea {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  resize: none;
}

button {
  padding: 10px 20px;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.winner-banner {
  text-align: center;
  background-color: #ffeb3b;
  color: #333;
  padding: 10px;
  font-weight: bold;
  border-top: 1px solid #ddd;
}

.warning-banner {
  background-color: #ffcc00;
  color: #333;
  text-align: center;
  padding: 10px;
  font-weight: bold;
  border-bottom: 1px solid #ddd;
}

.footer-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  background-color: #fff;
  border-top: 1px solid #ddd;
}

.difficulty-dropdown select {
  padding: 5px;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.token-count {
  text-align: right;
  font-weight: bold;
}
</style>
