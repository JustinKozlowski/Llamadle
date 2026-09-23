<template>
  <div class="inline-block">
    <button
      @click="showModal = true"
      class="bg-gray-400 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400"
      aria-label="What are tokens?"
    >
      i
    </button>

    <div
      v-if="showModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"
      @click="closeModal"
    >
      <div
        class="modal-background bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-5 rounded shadow-lg max-w-md w-full"
        @click.stop
      >
        <h2 class="text-xl font-bold mb-4">What's a Token?</h2>
        <p class="mb-4">
          A token is a metric for the amount of text the AI uses to communicate — roughly a word or part of a word.
          "Cats run" might be 2 tokens; "unbelievable" might be 3 or 4.
        </p>
        <p class="mb-4">
          Every message you send adds to your token count.
          Shorter, more efficient prompts keep your total low — so think carefully before you type!
        </p>
        <button
          @click="closeModal"
          class="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "TokenInfo",
  data() {
    return {
      showModal: false,
    };
  },
  methods: {
    closeModal() {
      this.showModal = false;
    },
  },
};
</script>

<style scoped>
.modal-background {
  backdrop-filter: blur(6px);
}
</style>
