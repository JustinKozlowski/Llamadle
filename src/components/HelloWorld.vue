<template>
  <div class="chat-app flex flex-col w-full h-[100dvh] bg-gray-100 dark:bg-gray-900 sm:max-w-lg sm:mx-auto sm:p-4 sm:rounded-lg shadow-md">
    <h1 
      v-if="!isKeyboardOpen"
      class="chat-title text-2xl font-bold text-center text-white bg-green-500 py-2 sm:rounded-t-lg"
    >
      Llamadle
    </h1>

    <div class="target-phrase-banner bg-orange-500 text-white text-center py-2 font-semibold px-2">
      Target Phrase: "{{ phrase.phrase }}"
    </div>

    <div class="chat-window flex flex-col flex-grow min-h-0 justify-end w-full sm:h-[500px] bg-white dark:bg-gray-800 sm:rounded-b-lg">
      <div class="chat-messages flex flex-col flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="[
            'chat-message p-3 rounded-lg max-w-[70%]',
            message.role === 'user'
              ? 'self-end bg-green-100 text-green-800 dark:bg-green-200 dark:text-green-900'
              : 'self-start bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
          ]"
        >
          <p class="message-content m-0">{{ message.parts[0].text }}</p>
        </div>
      </div>

      <div
        v-if="warningMessage"
        class="warning-banner bg-yellow-400 text-gray-800 text-center py-2 font-semibold dark:bg-yellow-500 dark:text-black"
      >
        {{ warningMessage }}
      </div>

      <div
        v-if="winner"
        class="winner-banner bg-yellow-300 text-gray-800 text-center py-2 font-semibold dark:bg-yellow-400 dark:text-black"
      >
        🎉 Congratulations! You found the phrase: "{{ phrase.phrase }}" in {{ tokenCount }} Tokens 🎉
        <button
          @click="loadNextPhrase"
          class="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 dark:hover:bg-green-400"
        >
          Next
        </button>
      </div>

      <div
        v-else
        class="chat-input flex gap-2 p-4 border-t dark:border-gray-600"
      >
        <textarea
          v-model="prompt"
          placeholder="Type your message..."
          rows="2"
          :disabled="loading"
          @keydown.enter.prevent="askPrompt"
          class="flex-1 p-2 border rounded-lg focus:outline-none focus:ring focus:ring-green-300 disabled:bg-gray-100 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-600 dark:border-gray-500"
        ></textarea>
        <button
          @click="askPrompt"
          :disabled="loading || !prompt.trim()"
          class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600"
        >
          {{ loading ? "Loading..." : "Send" }}
        </button>
      </div>

      <div 
        v-if="!isKeyboardOpen"
        class="footer-section flex justify-between items-center p-4 border-t bg-gray-50 dark:bg-gray-800 dark:border-gray-700 sm:rounded-b-lg"
      >
        <div class="difficulty-dropdown">
          <select
            id="difficulty"
            v-model="selectedDifficulty"
            @change="updateDifficulty"
            class="p-2 border rounded-lg dark:bg-gray-700 dark:text-white dark:border-gray-600"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <GameHelp />
        <div class="token-count text-sm font-semibold text-gray-900 dark:text-white">
          <p>Total Tokens: {{ tokenCount > 0 ? tokenCount : 0 }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { getPhrases } from "../phrases";
import { toRaw, } from 'vue';
import axios from 'axios';
import GameHelp from './Help.vue';

export default {
  name: "WebLLMComponent",
  components: {
    GameHelp,
  },
  data() {
    return {
      isKeyboardOpen: false,
      originalHeight: window.visualViewport.height,
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
      const originalPrompt = this.prompt;
      this.warningMessage = "";
      if (!this.prompt.trim()) {
        this.warningMessage = "Please enter a prompt.";
        return;
      }
      
      const bannedWord = this.containsBannedWords(this.prompt);
      if (bannedWord) {
        this.warningMessage = `Your prompt contains a banned word: "${bannedWord}". Please revise it.`;
        this.prompt = originalPrompt;
        return;
      }

      try {
        this.loading = true;
        const userMessage = { role: "user", parts: [ { text: toRaw(this.prompt) } ] };
        this.messages.push(userMessage);

        // Run Anti Cheat
        let hacky = await this.isInputHacky(this.prompt);
        const mispelledWords = hacky["mispelledWordsThatAreInBannedWordsList"];
        if (mispelledWords.length > 0) {
          // const mispelledWords = hacky["mispelledWordsThatAreInBannedWordsList"];
          this.warningMessage = `Your prompt seems to be similar to the banned word${mispelledWords.length > 1 ? "s" : "" }: ${mispelledWords.join(", ")}. Please revise it.`;
          this.messages.pop();
          this.prompt = originalPrompt;
          console.log(this.prompt);
          return;
        }

        // Get AI Response
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
        else {
          this.prompt = "";
        }
      } catch (error) {
        this.warningMessage = "An error occurred while processing your request. Please try again.";
        console.error(error);
        if (this.messages.at(-1).role !== "model"){
          // did not receive a response from model. Should pop the user message to track tokens and ui correctly
          this.messages.pop();
          this.prompt = originalPrompt;
        }
        else {
          this.prompt = '';
        }
      } finally {
        console.log('in finally');
        this.loading = false;
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
              text: `We are playing charades so we can't say certain words. 
We are allowed to describe words and use synonyms though. 
Is the given phrase attemping to spell the banned words? 
Do not allow leet speek of the banned words. 
Do not allow mispelling of the banned words.`
              // text: `Does the given phrase have any of the following words? Do not allow leet speek. Do not allow mispelling.`
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
              // mispelled: {
              //   type: "boolean"
              // },
              mispelledWordsThatAreInBannedWordsList: {
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
              // "mispelled",
              "mispelledWordsThatAreInBannedWordsList",
              "reason"
            ]
          }
        }
      };
      const response = await axios.post('https://www.justinkozlowski.me/gemini/gemini-2.0-flash', payload);
      console.log(JSON.parse(response.data.candidates[0].content.parts[0].text));
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
    handleResize() {
      const currentHeight = window.visualViewport.height;
      // Heuristic: keyboard likely open if height dropped >150px
      this.isKeyboardOpen = currentHeight < this.originalHeight - 150;
    },
  },
  mounted() {
    this.updateDifficulty();
    this.scrollToBottom();
    this.originalHeight = window.visualViewport.height;
    window.addEventListener('resize', this.handleResize);
  },
  unmounted() {
    window.removeEventListener('resize', this.handleResize);
  },
  updated() {
    this.scrollToBottom();
  },
};
</script>

<style scoped>
/* Removed existing styles as Tailwind CSS is now used */
</style>
