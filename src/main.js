import { createApp } from 'vue'
import App from './App.vue'
import { initializeEngine } from './engine';

createApp(App).mount('#app');

(async () => { await initializeEngine() })();
