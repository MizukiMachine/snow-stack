import './styles.css';
import forestFloorBackgroundUrl from './assets/backgrounds/snow-ground-forest-floor-d-v2.png';
import softFreshBackgroundUrl from './assets/backgrounds/snow-ground-soft-fresh-a-v2.png';
import thinIceBackgroundUrl from './assets/backgrounds/snow-ground-thin-ice-c-v2.png';
import { GameEngine } from './GameEngine';

type AppLogEntry = {
  level: 'error' | 'warn';
  message: string;
};

const BACKGROUND_IMAGE_URLS = [
  forestFloorBackgroundUrl,
  softFreshBackgroundUrl,
  thinIceBackgroundUrl
] as const;

const getRandomBackgroundImageUrl = (): string => {
  return BACKGROUND_IMAGE_URLS[Math.floor(Math.random() * BACKGROUND_IMAGE_URLS.length)];
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
viewport.style.setProperty('--game-shell-background-image', `url("${getRandomBackgroundImageUrl()}")`);
root.appendChild(viewport);

const engine = new GameEngine();
window.__engine = engine;
engine.start(viewport);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.stop();
  });
}
