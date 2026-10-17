import '@mantine/core/styles.css';
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { captureToken } from './api/auth';
import App from './app/app';

captureToken();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
