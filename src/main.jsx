import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

// Track whether the last input was touch or mouse, so CSS :hover styles
// only apply for real pointer devices and never get "stuck" after a tap.
const root = document.documentElement;
window.addEventListener('touchstart', () => root.classList.add('is-touch'), { passive: true });
window.addEventListener('mousemove', () => root.classList.remove('is-touch'), { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);