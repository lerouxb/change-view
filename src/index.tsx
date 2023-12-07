import React from 'react';
import ReactDOM from 'react-dom';
import { LeafyGreenProvider } from '@mongodb-js/compass-components';
import './index.css';
import App from './App';


const darkMode = true;

ReactDOM.render(
  <React.StrictMode>
    <LeafyGreenProvider darkMode={darkMode}>
      <App />
    </LeafyGreenProvider>
  </React.StrictMode>,
  document.getElementById('app') as HTMLElement
);
