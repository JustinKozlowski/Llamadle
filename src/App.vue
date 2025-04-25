<template>
  <div id="app">
    <GameHelp />
    <HelloWorld />
  </div>
</template>

<script>
import HelloWorld from './components/HelloWorld.vue';
import GameHelp from './components/Help.vue';

export default {
  name: 'App',
  components: {
    HelloWorld,
    GameHelp,
  },
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
