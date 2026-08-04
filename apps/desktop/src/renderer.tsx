import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

function App() {
  return (
    <main className="shell">
      <h1>EchoNote</h1>
      <p>Electron 개발 골격 준비 완료</p>
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element를 찾을 수 없습니다.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
