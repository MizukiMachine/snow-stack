import './styles.css';
import { GameEngine } from './GameEngine';

type AppLogEntry = {
  level: 'error' | 'warn';
  message: string;
};

declare global {
  interface Window {
    __appLogs?: AppLogEntry[];
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
root.appendChild(viewport);

const engine = new GameEngine();
engine.start(viewport);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.stop();
  });
}
