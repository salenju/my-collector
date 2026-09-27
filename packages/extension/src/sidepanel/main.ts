import { createApp } from 'vue';
import '../styles.css';
import { applyExtensionTheme } from '../shared/theme';
import PanelApp from './PanelApp.vue';

applyExtensionTheme();
createApp(PanelApp).mount('#app');
