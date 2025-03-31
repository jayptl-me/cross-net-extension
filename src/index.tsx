import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/transaction-cards.css'; // Import the transaction card styles
import App from './App';
import reportWebVitals from './reportWebVitals';

// Initialize EIP-6963 wallet detection
function initializeWalletDetection() {
  // Only run in browser environments
  if (typeof window === 'undefined') return;

  // Listen for wallet discovery requests
  window.addEventListener('eip6963:requestProvider', () => {
    // Announce our wallet provider to the dApp
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: {
            uuid: 'a6708e1d-2574-4f03-8f98-c641a4cf12be', // Unique identifier for Cross-Net wallet
            name: 'Cross-Net Wallet',
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTAgMjBDMTUuNTIyOSAyMCAyMCAxNS41MjI5IDIwIDEwQzIwIDQuNDc3MTUgMTUuNTIyOSAwIDEwIDBDNC40NzcxNSAwIDAgNC40NzcxNSAwIDEwQzAgMTUuNTIyOSA0LjQ3NzE1IDIwIDEwIDIwWiIgZmlsbD0iIzA1NjJDMyIvPjxwYXRoIGQ9Ik0xNCAxNkgxMkw5IDEwTDYgMTZINEw4IDhIMTBMMTQgMTZaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==', // Encode your icon as base64
            rdns: 'com.crossnet.wallet'
          },
          provider: window.crossNetWallet || window.ethereum // Use the available provider
        }
      })
    );
  });

  // Automatically announce the provider when page loads (some dApps expect this)
  if (window.crossNetWallet || window.ethereum) {
    setTimeout(() => {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    }, 100);
  }
}

// Run wallet detection after DOM content is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeWalletDetection);
} else {
  initializeWalletDetection();
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
