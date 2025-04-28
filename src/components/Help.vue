<template>
  <div>
    <button @click="showModal = true">How to Play</button>

    <div v-if="showModal" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <h2>How to Play</h2>
        <p>
          Welcome to Llamadle!
          The goal of the game is to prompt the LLM to guess the secret phrase.
          Try to reach the phrase in the fewest tokens possible!
        </p>
        <button @click="closeModal">Close</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "HelpModal",
  data() {
    return {
      showModal: true,
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
</style>
