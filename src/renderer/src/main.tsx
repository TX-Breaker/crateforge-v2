import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppStateProvider } from './lib/appState';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>
);
