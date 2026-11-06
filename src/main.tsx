import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AppBoundary } from './ui/ErrorBoundary';
import { loadMathLive } from './ui/MathInput';
// fonts are served with the app (no Google Fonts request): Latin subsets of IBM Plex (D38)
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';

// Nothing should move after the first paint (D39): wait for the maths editor and the fonts that set
// row heights and text widths, then render once. Capped, so a slow network still shows the page.
const fonts = ['400 15px "IBM Plex Sans"', '500 15px "IBM Plex Sans"', '600 16px "IBM Plex Sans"', '400 11px "IBM Plex Mono"', '21px KaTeX_Main', 'italic 21px KaTeX_Main', 'italic 21px KaTeX_Math', '21px KaTeX_Size1'];
const ready = Promise.all([loadMathLive(), ...fonts.map((f) => document.fonts?.load(f).catch(() => undefined))]);
const cap = new Promise((r) => setTimeout(r, 2500));
void Promise.race([ready, cap]).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppBoundary>
        <App />
      </AppBoundary>
    </StrictMode>,
  ),
);

// offline support (D38): production builds only, so development always shows fresh code
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
