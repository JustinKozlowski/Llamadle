<template>
  <div id="app" class="h-[var(--viewport-height)] bg-white text-gray-900 dark:bg-gray-900 dark:text-white flex items-center justify-center">
    <HelloWorld />
  </div>
</template>

<script>
import HelloWorld from './components/HelloWorld.vue';

export default {
  name: 'App',
  components: {
    HelloWorld,
  },
  data() {
    return {
      isKeyboardOpen: false,
      originalHeight: window.visualViewport.height,
    }
  },
  methods: {
    handleResize() {
      const currentHeight = window.visualViewport.height;
      // Heuristic: keyboard likely open if height dropped >150px
      this.isKeyboardOpen = currentHeight < this.originalHeight - 150;
      document.documentElement.style.setProperty('--viewport-height', `${currentHeight}px`);
      if (this.isKeyboardOpen){
        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 10);
        // this.$nextTick(() => {
        //   window.scrollTo(0, 0);
        // });
      }
    },
  },
  mounted() {
    this.originalHeight = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', this.handleResize);
  },
  unmounted() {
    window.visualViewport.removeEventListener('resize', this.handleResize);
  },
};
</script>

<style>
:root {
  --viewport-height: 100vh; /* Default to full viewport height */
}
.chat-app {
  height: var(--viewport-height); /* Use dynamic height */
}
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
}
</style>
