<template>
  <div class="chat-app flex flex-col w-full h-[var(--viewport-height)] bg-gray-100 dark:bg-gray-900 sm:max-w-lg sm:mx-auto sm:p-4 sm:rounded-lg shadow-md">
    <h1 
      v-if="!isKeyboardOpen"
      class="chat-title text-2xl font-bold text-center text-white bg-green-500 py-2 sm:rounded-t-lg"
    >
      Llamadle
    </h1>

    <div class="target-phrase-banner bg-orange-500 text-white text-center py-2 font-semibold px-2">
      <p>Target Phrase: "{{ phrase }}"</p>
      <!-- {{ debug }} -->
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
        v-if="gameOver"
        class="winner-banner bg-yellow-300 text-gray-800 text-center py-2 font-semibold dark:bg-yellow-400 dark:text-black"
      >
        <p v-if="winner" class="m-0 inline-flex items-center gap-1.5 justify-center">
          You found today's phrase in {{ tokenCount }} tokens!
        </p>
        <p v-else class="m-0">You didn't find the phrase</p>
        <button
          @click="shareResult"
          class="mt-2 inline-flex items-center gap-1 px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 dark:hover:bg-green-400 text-sm font-normal"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          {{ copied ? "Copied!" : "Share" }}
        </button>
      </div>

      <div
        v-else
        class="chat-input flex gap-2 p-4 border-t dark:border-gray-600"
      >
        <textarea
          ref="promptArea"
          v-model="prompt"
          placeholder="Type your message..."
          rows="1"
          id="prompt-area"
          :disabled="initialLoading"
          @keydown.enter.prevent="askPrompt"
          @input="autoGrowPrompt"
          class="flex-1 p-2 border rounded-lg resize-none overflow-hidden max-h-40 focus:outline-none focus:ring focus:ring-green-300 disabled:bg-gray-100 dark:bg-gray-700 dark:text-white dark:disabled:bg-gray-600 dark:border-gray-500"
        ></textarea>
        <button
          @click="askPrompt"
          :disabled="initialLoading || loading || !prompt.trim()"
          class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-600"
        >
          {{ initialLoading ? "Loading..." : (loading ? "Loading..." : "Send") }}
        </button>
      </div>

      <div 
        class="footer-section flex justify-between items-center p-4 border-t bg-gray-50 dark:bg-gray-800 dark:border-gray-700 sm:rounded-b-lg"
      >
        <div class="difficulty-dropdown"
          v-if="!isKeyboardOpen"
        >
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
        
        <keep-alive>
          <GameHelp
            v-if="!isKeyboardOpen"
          />
        </keep-alive>
        <div class="token-count flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"
          v-if="!isKeyboardOpen"
        >
          <p>Total Tokens: {{ tokenCount > 0 ? tokenCount : 0 }}</p>
          <TokenInfo />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { toRaw, } from 'vue';
import axios from 'axios';
import GameHelp from './Help.vue';
import TokenInfo from './TokenInfo.vue';

export default {
  name: "WebLLMComponent",
  components: {
    GameHelp,
    TokenInfo,
  },
  data() {
    return {
      isKeyboardOpen: false,
      originalHeight: window.visualViewport.height,
      prompt: "",
      messages: [],
      // debug: 0,
      loading: false,
      initialLoading: true,
      puzzleNumber: null,
      phrase: "",
      bannedWords: [],
      winner: false,
      alreadyCompleted: false,
      shareText: "",
      copied: false,
      tokenCount: 0,
      warningMessage: "",
      selectedDifficulty: "medium",
    };
  },
  computed: {
    // True once today's puzzle for the current difficulty is done, win or (guess-cap) loss —
    // gates the chat input off in favor of the share-text banner.
    gameOver() {
      return this.winner || this.alreadyCompleted;
    },
  },
  watch: {
    // Reset the textarea back to one row once a guess is sent/cleared — autoGrowPrompt only
    // ever grows the element (setting height:auto then re-measuring scrollHeight), so an
    // empty prompt needs its own explicit shrink-back.
    prompt(newValue) {
      if (newValue) return;
      this.$nextTick(() => {
        const el = this.$refs.promptArea;
        if (el) el.style.height = 'auto';
      });
    },
  },
  methods: {
    autoGrowPrompt(event) {
      this.growPromptArea(event.target);
    },
    // autoGrowPrompt only runs on the textarea's `input` event, so restoring a rejected
    // prompt via v-model (banned word, flagged guess, or request error) leaves the box
    // sized for whatever was in it before — grow it manually in those cases.
    growPromptArea(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    },
    containsBannedWords(input) {
      return this.bannedWords.find((word) => input.toLowerCase().includes(word.toLowerCase()));
    },
    async shareResult() {
      // Prefer the native share sheet (mobile browsers) — falls through to a clipboard copy
      // if unsupported, unavailable, or the share itself fails for a reason other than the
      // user just cancelling it.
      if (navigator.share) {
        try {
          await navigator.share({ text: this.shareText });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          console.error(error);
        }
      }
      try {
        await navigator.clipboard.writeText(this.shareText);
        this.copied = true;
        setTimeout(() => { this.copied = false; }, 2000);
      } catch (error) {
        console.error(error);
        this.warningMessage = "Couldn't share or copy to clipboard.";
      }
    },
    // Fetches today's puzzle (and any in-progress attempt) for the current difficulty from the
    // server — the server is now the source of truth for the daily puzzle and "already
    // completed" state, replacing the old locally-cycled phrase pool.
    async loadGame() {
      this.initialLoading = true;
      this.warningMessage = "";
      try {
        const response = await axios.get('/llamadle/game', { params: { difficulty: this.selectedDifficulty } });
        const data = response.data;
        this.puzzleNumber = data.puzzleNumber;
        this.prompt = "";
        // Common to both branches: the phrase and the guess/reply transcript so far persist
        // across switching difficulty and back, whether or not the game's finished.
        this.phrase = data.phrase;
        this.tokenCount = data.tokenTotal;
        this.messages = (data.transcript || []).map((t) => ({
          role: t.role === 'guess' ? 'user' : 'model',
          parts: [{ text: t.text }],
        }));
        if (data.alreadyCompleted) {
          this.alreadyCompleted = true;
          this.winner = Boolean(data.won);
          this.shareText = data.share || "";
        } else {
          this.alreadyCompleted = false;
          this.winner = false;
          this.bannedWords = data.bannedWords;
        }
      } catch (error) {
        this.warningMessage = "Couldn't load today's puzzle. Please try reloading the page.";
        console.error(error);
      } finally {
        this.initialLoading = false;
      }
    },
    async askPrompt() {
      if (this.loading || this.initialLoading){
        return;
      }
      this.$nextTick(() => {
        const textarea = document.getElementById('prompt-area');
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
      });
      const originalPrompt = this.prompt;
      this.prompt = "";
      this.warningMessage = "";
      if (!originalPrompt.trim()) {
        this.warningMessage = "Please enter a prompt.";
        this.prompt = originalPrompt;
        this.$nextTick(() => this.growPromptArea(this.$refs.promptArea));
        return;
      }

      const bannedWord = this.containsBannedWords(originalPrompt);
      if (bannedWord) {
        this.warningMessage = `Your prompt contains a banned word: "${bannedWord}". Please revise it.`;
        this.prompt = originalPrompt;
        this.$nextTick(() => this.growPromptArea(this.$refs.promptArea));
        return;
      }

      try {
        this.loading = true;
        const userMessage = { role: "user", parts: [ { text: toRaw(originalPrompt) } ] };
        this.messages.push(userMessage);

        // Judge + opponent both run server-side now, in one round trip.
        const response = await axios.post('/llamadle/guess', {
          difficulty: this.selectedDifficulty,
          text: originalPrompt,
        });
        const data = response.data;

        if (data.flagged) {
          const mispelledWords = data.matchedWords || [];
          this.warningMessage = `Your prompt seems to be similar to the banned word${mispelledWords.length > 1 ? "s" : "" }: ${mispelledWords.join(", ")}. Please revise it.`;
          this.messages.pop();
          this.prompt = originalPrompt;
          this.$nextTick(() => this.growPromptArea(this.$refs.promptArea));
          return;
        }

        const aiMessage = { role: "model", parts: [ { text: data.replyText } ] };
        this.messages.push(aiMessage);
        this.tokenCount = data.tokenTotal;

        if (data.won) {
          this.winner = true;
          this.shareText = data.share || "";
        }
      } catch (error) {
        const status = error.response && error.response.status;
        if (status === 403 || status === 409 || status === 429) {
          // Our local state disagrees with the server's (already completed, stale puzzle, or
          // guess cap hit) — resync from the source of truth instead of guessing why.
          if (this.messages.at(-1) && this.messages.at(-1).role !== "model") {
            this.messages.pop();
          }
          await this.loadGame();
          return;
        }
        this.warningMessage = "An error occurred while processing your request. Please try again.";
        console.error(error);
        if (this.messages.at(-1) && this.messages.at(-1).role !== "model"){
          // did not receive a response from model. Should pop the user message to track tokens and ui correctly
          this.messages.pop();
          this.prompt = originalPrompt;
          this.$nextTick(() => this.growPromptArea(this.$refs.promptArea));
        }
      } finally {
        this.loading = false;
        this.$nextTick(() => {
          const textarea = document.getElementById('prompt-area');
          if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          }
        });
      }
    },
    updateDifficulty() {
      this.loadGame();
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
      console.log(currentHeight);
      // this.debug = currentHeight;
      this.isKeyboardOpen = currentHeight < this.originalHeight - 150;
    },
  },
  mounted() {
    this.scrollToBottom();
    this.originalHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', this.handleResize);
    this.loadGame();
  },
  unmounted() {
    window.visualViewport.removeEventListener('resize', this.handleResize);
  },
  updated() {
    this.scrollToBottom();
  },
};
</script>

<style scoped>
/* Removed existing styles as Tailwind CSS is now used */
</style>
