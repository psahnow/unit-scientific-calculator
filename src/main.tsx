import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AppBoundary } from './ui/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </StrictMode>,
);
