import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { view, requestJira, invoke } from '@forge/bridge';
import ForgeRoot from './ForgeRoot.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ForgeRoot bridge={{ view, requestJira, invoke }} />
  </StrictMode>,
);
