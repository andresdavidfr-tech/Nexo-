import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log("App starting initialization...");

// Help debug production "white screen" issues
window.addEventListener('error', (event) => {
  console.error('CRITICAL APP ERROR:', event.error);
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("Root element not found!");
} else {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log("Root render called successfully");
  } catch (err) {
    console.error("Error during root render:", err);
  }
}
