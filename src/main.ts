import './styles.css';
import { GameEngine } from './GameEngine';

const SOFT_FRESH_WIDESCREEN_BACKGROUND_URL =
  '/assets/backgrounds/snow-ground-soft-fresh-a-widescreen-topdown.png';

type AppLogEntry = {
  level: 'error' | 'warn';
  message: string;
};

declare global {
  interface Window {
    __appLogs?: AppLogEntry[];
    __engine?: GameEngine;
  }
}

window.__appLogs = [];

const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  window.__appLogs?.push({ level: 'warn', message: args.map(String).join(' ') });
  originalWarn(...args);
};

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  window.__appLogs?.push({ level: 'error', message: args.map(String).join(' ') });
  originalError(...args);
};

window.addEventListener('error', (event) => {
  window.__appLogs?.push({
    level: 'error',
    message: event.message || 'Unknown window error'
  });
});

window.addEventListener('unhandledrejection', (event) => {
  window.__appLogs?.push({
    level: 'error',
    message: String(event.reason)
  });
});

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app コンテナが見つかりませんでした。');
}

const viewport = document.createElement('div');
viewport.className = 'app-viewport';
viewport.style.setProperty(
  '--game-shell-background-image',
  `url("${SOFT_FRESH_WIDESCREEN_BACKGROUND_URL}")`
);
root.appendChild(viewport);

const engine = new GameEngine();
window.__engine = engine;
engine.start(viewport);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.stop();
  });
}
