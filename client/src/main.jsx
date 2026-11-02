import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useStore } from './state/store.js';
import { sync } from './state/sync.js';
import { getEngine } from './audio/index.js';
import { renderProject } from './audio/render.js';
import { loadSampleBank, hasSampleBank, sampleRange, sampleBankReady, renderSampledNote } from './audio/sampleBank.js';
import { renderModel, modelOf } from './audio/models.js';
import './styles.css';

useStore.getState().initAuth();

// Handy for debugging and scripting from the browser console:
//   greanteadawy.store.getState().project, greanteadawy.engine()
window.greanteadawy = {
  store: useStore, engine: getEngine, sync, render: renderProject,
  // 排查音色用：采样库状态、音区、单个音符的渲染结果
  sampleBank: { load: loadSampleBank, has: hasSampleBank, range: sampleRange, ready: sampleBankReady, render: renderSampledNote },
  models: { render: renderModel, of: modelOf }
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
