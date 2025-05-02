<template>
  <div class="chat-app">
    <h1 class="chat-title">Llamadle</h1>
    <div class="target-phrase-banner">
      Target Phrase: "{{ phrase.phrase }}"
    </div>
    <div class="chat-window">
      <div class="chat-messages">
        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="['chat-message', message.role]"
        >
          <p class="message-content">{{ message.parts[0].text }}</p>
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
import { getPhrases } from "../phrases";
import { toRaw } from "vue";
import axios from 'axios';

export default {
  name: "WebLLMComponent",
  data() {
    return {
      prompt: "",
      messages: [],
      loading: false,
      phrase: getPhrases()[0],
      bannedWords: getPhrases()[0].difficulty[this.selectedDifficulty],
      runningTokenCount: 0,
      winner: false,
      tokenCount: 0,
      preprocessed: false,
      warningMessage: "",
      selectedDifficulty: "medium",
    };
  },
  methods: {
    checkForWinner(response, phrase) {
      return response.toLowerCase().includes(phrase.toLowerCase());
    },
    makeWinner() {
      this.winner = true;
    },
    containsBannedWords(input) {
      return this.bannedWords.find((word) => input.toLowerCase().includes(word.toLowerCase()));
    },
    async askPrompt() {
      this.winner = false;
      this.warningMessage = "";
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
        const userMessage = { role: "user", parts: [ { text: toRaw(this.prompt) } ] };
        this.messages.push(userMessage);
        let hacky = await this.isInputHacky(this.prompt);
        if (hacky['bypassing']) {
          this.warningMessage = `Your prompt seems to be similar to the banned word${hacky["matchedWords"].length > 1 ? "s" : "" }: ${hacky["matchedWords"].join(", ")}. Please revise it.`;
          this.messages.pop();
          return;
        }

        const payload = {
          "system_instruction": {
            "parts": [
              {
                "text": "Respond in 1 sentence"
              }
            ]
          },
          "contents": this.messages,
        };
        const endpointMap = {
          "easy": "gemini/gemini-2.5-flash",
          "medium": "gemini/gemini-2.0-flash",
          "hard": "gemini/gemini-1.5-flash"
        }
        const response = await axios.post(`https://www.justinkozlowski.me/${endpointMap[this.selectedDifficulty]}`, payload);

        this.tokenCount += (response.data.usageMetadata.promptTokenCount - this.runningTokenCount);
        this.runningTokenCount = response.data.usageMetadata.totalTokenCount;
        const aiMessage = { role: "model", parts: [ { text: response.data.candidates[0].content.parts[0].text } ] };
        console.log(aiMessage);
        this.messages.push(aiMessage);

        if (this.checkForWinner(aiMessage.parts[0].text, this.phrase.phrase)) {
          this.makeWinner();
        }
      } catch (error) {
        this.warningMessage = "An error occurred while processing your request. Please try again.";
        console.error(error);
      } finally {
        this.loading = false;
        this.prompt = "";
        this.$nextTick(() => {
          const textarea = this.$el.querySelector('textarea');
          if (textarea) textarea.focus();
        });
      }
    },
    async isInputHacky(input) {
      const payload = {
        system_instruction: {
          parts: [
            {
              text: `Is the given phrase attemping to bypass the banned words? Focus on intent. Allow synonym words. Do not allow leet speek. Do not allow mispelling.`
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [ { text: `Banned Words: ${JSON.stringify(this.bannedWords)}. Phrase: ${input}` } ]
          }
        ],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: {
            type: "object",
            properties: {
              bypassing: {
                type: "boolean"
              },
              matchedWords: {
                type: "array",
                items: {
                  type: "string"
                }
              },
              reason: {
                type: "string"
              },
            },
            required: [
              "bypassing",
              "reason"
            ]
          }
        }
      };
      const response = await axios.post('https://www.justinkozlowski.me/gemini/gemini-2.0-flash', payload);
      console.log(response.data.candidates[0].content.parts[0].text);
      return JSON.parse(response.data.candidates[0].content.parts[0].text);
    },
    updateDifficulty() {
      this.bannedWords = this.phrase.difficulty[this.selectedDifficulty];
      this.winner = false;
      this.messages = [];
      this.tokenCount = 0; // Reset token count for the new phrase
      this.runningTokenCount = 0; // Reset token count for the new phrase
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

.chat-message.model {
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
