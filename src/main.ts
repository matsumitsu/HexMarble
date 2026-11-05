import './style.css';
import { App } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');
new App(root);
