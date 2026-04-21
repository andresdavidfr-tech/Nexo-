import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Help debug production "white screen" issues
window.addEventListener('error', (event) => {
  console.error('CRITICAL APP ERROR:', event.error);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
