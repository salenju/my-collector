import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { useAppStore } from './stores/app';
import './styles/tailwind.css';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);
app.mount('#app');

// 启动：先读本地缓存渲染，再后台同步（不阻塞首屏）
void useAppStore(pinia).boot();
