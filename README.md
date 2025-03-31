# Cross-Net Wallet

![Cross-Net Logo](https://via.placeholder.com/150x150.png?text=Cross-Net)

**Cross-Net Wallet** is a web3 browser wallet extension that enables seamless cross-chain transactions and asset management across multiple blockchain networks, with built-in cross-browser compatibility.

## 🌉 Overview

Cross-Net Wallet is designed to simplify the multi-chain experience for both users and developers. It injects a standard Ethereum provider that follows EIP-1193 and EIP-6963 standards, allowing for smooth integration with existing dApps while providing enhanced cross-chain capabilities. Built on Manifest V3 with a unified browser API abstraction layer, it works flawlessly across Chrome, Firefox, and other Chromium-based browsers.

## ✨ Features

- **EIP-1193 Compliance**: Full compatibility with the standard Ethereum Provider API
- **EIP-6963 Support**: Multi-wallet detection and announcement for modern dApps
- **Cross-Chain Operations**: Easily switch between and interact with multiple blockchains
- **Cross-Browser Compatibility**: Unified browser extension API that works across Chrome, Firefox, and Edge
- **Manifest V3 Support**: Built on the latest extension platform for improved security and performance
- **Transaction Management**: Send, sign, and track transactions across networks
- **Chain Management**: Add custom networks and switch between chains
- **Multi-Asset Support**: Manage multiple tokens and NFTs across different chains from a single interface
- **Robust Error Handling**: Standardized error codes and messages
- **Event System**: Real-time notifications of account, network, and wallet state changes
- **Developer-Friendly**: Extensive logging and debugging features

## 🔧 Technical Implementation

Cross-Net Wallet injects a provider script into web pages that:

1. Registers as an Ethereum provider (window.ethereum)
2. Announces itself via EIP-6963 for multi-wallet environments
3. Communicates with the background wallet service via a messaging system
4. Handles all standard Ethereum JSON-RPC methods
5. Manages connection state and emits appropriate events

### Browser Compatibility Layer

At the core of Cross-Net Wallet is our sophisticated browser compatibility layer that:

- Abstracts away differences between Chrome, Firefox, and other browsers' extension APIs
- Automatically detects the browser environment and adapts accordingly
- Provides a consistent Promise-based interface regardless of the underlying browser
- Handles context invalidation and extension lifecycle events gracefully
- Maintains secure communication channels between content scripts and background services

```javascript
// Example of our browser compatibility abstraction
const browserAPI = (function() {
  const isFirefox = typeof browser !== 'undefined';
  
  return {
    storage: {
      local: {
        get: function(keys) {
          return new Promise((resolve) => {
            if (isFirefox) {
              browser.storage.local.get(keys).then(resolve);
            } else {
              chrome.storage.local.get(keys, resolve);
            }
          });
        }
        // ...other methods
      }
    }
    // ...other APIs
  };
})();
```

### Multi-Chain Architecture

Our wallet maintains reliable connections to multiple blockchains simultaneously through:

- Dynamic RPC endpoint management with automatic fallbacks for improved reliability
- Efficient in-memory caching system for RPC requests to minimize network calls
- Parallel batch processing of requests across different chains
- Chain-specific transaction formatting and signing
- Unified asset catalog system that works across all supported chains

## 📚 API Reference

### Standard Methods

| Method | Description |
|--------|-------------|
| `eth_requestAccounts` | Requests user permission to connect to their accounts |
| `eth_accounts` | Returns a list of connected accounts |
| `eth_chainId` | Returns the current chain ID |
| `eth_sendTransaction` | Submits a transaction for user approval and network broadcast |
| `personal_sign` | Signs a personal message |
| `eth_signTransaction` | Signs a transaction without sending it |
| `eth_getBalance` | Retrieves an account's balance |
| `wallet_switchEthereumChain` | Switches to a different blockchain network |
| `wallet_addEthereumChain` | Adds a new blockchain network |
| `eth_sign` | Signs data with an Ethereum account |
| `eth_signTypedData` | Signs typed data according to EIP-712 |

### Events

| Event | Parameters | Description |
|-------|------------|-------------|
| `accountsChanged` | `Array<string>` | Emitted when the accounts array changes |
| `chainChanged` | `string` | Emitted when the connected chain changes |
| `connect` | `{ chainId: string }` | Emitted when the provider is connected |
| `disconnect` | `Error` | Emitted when the provider loses its connection |
| `networkChanged` | `string` | Legacy event emitted for network changes |
| `chainIdChanged` | `string` | Alternative event for chain ID changes |

## 🚀 Getting Started

### For Users

1. Install the Cross-Net Wallet extension from your browser's extension store
2. Create a new wallet or import an existing one
3. Browse to your favorite dApp and connect your wallet
4. Enjoy seamless cross-chain interactions!

### For Developers

To interact with Cross-Net Wallet in your dApp:

```javascript
// Check if Cross-Net is available
if (window.ethereum) {
  try {
    // Request user permission to connect
    const accounts = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    
    // Get the current chain ID
    const chainId = await window.ethereum.request({ 
      method: 'eth_chainId' 
    });
    
    console.log(`Connected to chain ${chainId} with account ${accounts[0]}`);
    
    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts) => {
      console.log('Accounts changed:', accounts);
    });
    
    // Listen for chain changes
    window.ethereum.on('chainChanged', (chainId) => {
      console.log('Chain changed:', chainId);
      // Reload the page to refresh state
      window.location.reload();
    });
    
  } catch (error) {
    console.error('Error connecting to wallet:', error);
  }
}
```

For EIP-6963 compatibility:

```javascript
// Request all available providers
window.dispatchEvent(new Event('eip6963:requestProvider'));

// Listen for provider announcements
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail;
  
  if (info.rdns === 'com.crossnet.wallet') {
    console.log('Cross-Net Wallet detected!');
    // Use provider to interact with the wallet
  }
});
```

### Working with Multiple Chains

Cross-Net Wallet makes it easy to work with multiple chains:

```javascript
// Switch to Polygon network
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x89' }] // Polygon's chain ID in hex
});

// Send a transaction on the current network
const txHash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [{
    from: accounts[0],
    to: '0xRecipientAddress',
    value: '0x38D7EA4C68000', // 0.001 ETH in hex
    gasLimit: '0x5208', // 21000 gas in hex
  }]
});

// Wait for confirmation and track status
console.log(`Transaction submitted: ${txHash}`);
```

## 🧪 Testing

To test Cross-Net Wallet with your dApp:

1. Install the extension
2. Enable developer mode in the extension
3. Use the test networks and test accounts provided
4. Check the console for detailed logs of all wallet operations

## 🔒 Security

Cross-Net Wallet implements several security features:

- Private keys never leave the extension
- All communications are encrypted
- Signed transactions require explicit user approval
- Chain switching and adding requires user permission
- No automatic connections without user consent
- Manifest V3 service worker architecture for improved security isolation
- Advanced RPC endpoint monitoring and failover protection
- Comprehensive input validation and sanitization

## 🤝 Contributing

We welcome contributions to Cross-Net Wallet! Please see our [Contributing Guidelines](CONTRIBUTING.md) for more information.

## 📄 License

Cross-Net Wallet is released under the [MIT License](LICENSE).

## 📞 Contact

For questions, support, or feedback, please reach out to:

---

Built with ❤️ for the Web3 community
