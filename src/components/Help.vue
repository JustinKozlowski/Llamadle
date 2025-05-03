<template>
  <div>
    <!-- Question Mark Button -->
    <button
      @click="showModal = true"
      class="bg-green-500 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl hover:bg-green-600"
      aria-label="How to Play"
    >
      ?
    </button>

    <!-- Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"
      @click="closeModal"
    >
      <div
        class="modal-background bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-5 rounded shadow-lg max-w-md w-full"
        @click.stop
      >
        <h2 class="text-xl font-bold mb-4">How to Play</h2>
        <p class="mb-4">
          Welcome to Llamadle!  
          The goal of the game is to prompt the LLM to guess the secret phrase.  
          Try to reach the phrase in the fewest tokens possible!
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
  name: "HelpModal",
  data() {
    return {
      showModal: false,
      firstLoad: true,
    };
  },
  methods: {
    closeModal() {
      this.showModal = false;
    },
  },
  mounted() {
    if (this.firstLoad) {
      console.log('first load of modal');
      this.firstLoad = false;
      this.showModal = true;
    }
  }
};
</script>

<style scoped>
.modal-background {
  backdrop-filter: blur(6px);
}
</style>
