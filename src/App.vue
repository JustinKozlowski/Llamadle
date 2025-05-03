<template>
  <div id="app" class="h-[100dvh] bg-white text-gray-900 dark:bg-gray-900 dark:text-white flex items-center justify-center">
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
};
</script>

<style>
/* Optional: remove if not needed anymore */
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
}
</style>
