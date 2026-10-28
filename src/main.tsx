import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-tc/chinese-traditional-400.css';
import '@fontsource/noto-sans-tc/chinese-traditional-500.css';
import '@fontsource/noto-sans-tc/chinese-traditional-700.css';
import '@fontsource/noto-sans-tc/latin-400.css';
import '@fontsource/noto-sans-tc/latin-500.css';
import '@fontsource/noto-sans-tc/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到根節點');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
