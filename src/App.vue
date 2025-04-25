<template>
  <GameHelp />
  <HelloWorld />
  <div v-if="!engineLoaded">Download Progress: {{ downloadProgress }}%</div>
</template>

<script>
import HelloWorld from './components/HelloWorld.vue';
import GameHelp from './components/Help.vue';
import { getDownloadProgress, isEngineLoaded } from './engine';

export default {
  name: 'App',
  components: {
    HelloWorld,
    GameHelp,
  },
  data() {
    return {
      downloadProgress: 0,
      engineLoaded: false,
    };
  },
  mounted() {
    this.updateProgress();
  },
  methods: {
    updateProgress() {
      const interval = setInterval(() => {
        this.downloadProgress = getDownloadProgress();
        this.engineLoaded = isEngineLoaded();
        if (this.engineLoaded) {
          clearInterval(interval);
        }
      }, 500);
    },
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
