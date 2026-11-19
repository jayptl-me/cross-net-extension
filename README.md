# Cross-Net Wallet

A Manifest V3 browser wallet extension that injects an EIP-1193 and
EIP-6963 Ethereum provider into web pages.

Cross-Net Wallet lets a dapp connect, sign and send transactions through
`window.ethereum`, while keys, approvals and network switching live inside
the extension. A browser compatibility layer normalises the Chrome and
Firefox extension APIs behind one promise-based interface.

- **Standard provider.** Injects `window.ethereum` implementing the
  EIP-1193 request API and announces itself over EIP-6963 for multi-wallet
  detection (`rdns: com.crossnet.wallet`).
- **Four built-in networks.** Ethereum mainnet, Polygon, Sepolia and
  Polygon Amoy ship in `src/interfaces/Chain.ts`, each with fallback RPC
  endpoints and a block explorer link; custom networks can be added in
  settings.
- **Approval UI.** Connection and transaction requests open extension
  screens (`ConnectApproval`, `TransactionApproval`) instead of signing
  silently.
- **Cross-browser layer.** `public/utils/browser-compat.js` detects the
  browser and exposes one storage, tabs and runtime API.
- **Transaction history.** Fetches recent transactions per network through
  the Alchemy SDK when an API key is configured.
- **React popup UI.** React 18 and TypeScript, built with
  react-scripts and loaded as an unpacked extension.

## Run it

### Prerequisites

- Node.js and npm (or Bun - a `bun.lock` is also committed)
- A Chromium or Firefox browser for loading the unpacked build
- Optional: an Alchemy API key for transaction history

### Build the extension

```sh
npm install
npm run build:extension
```

`build:extension` sets `INLINE_RUNTIME_CHUNK=false` (required by Manifest
V3), produces `build/` and copies `background.js`, `contentScript.js` and
`injectScript.js` from `public/` into it.

Then load `build/` as an unpacked extension: `chrome://extensions` with
Developer mode on, or `about:debugging` in Firefox.

### Configure

Transaction history needs an Alchemy key in a `.env` file at the project
root:

```dotenv
REACT_APP_ALCHEMY_API_KEY=your-alchemy-api-key
```

The wallet works without it; only the history list is affected.

### Develop

```sh
npm start    # CRA dev server for the popup UI
npm test     # react-scripts test
```

## Provider API

`window.ethereum.request` handles the standard read and signing methods:

| Method                    | Description                              |
| ------------------------- | ---------------------------------------- |
| `eth_requestAccounts`     | Connect; opens the approval screen       |
| `eth_accounts`            | Connected accounts                       |
| `eth_chainId`             | Current chain ID                          |
| `eth_sendTransaction`     | Send a transaction (with approval)       |
| `eth_signTransaction`     | Sign without sending                     |
| `personal_sign`           | Sign a personal message                  |
| `eth_sign`                | Sign data                                |
| `eth_signTypedData` (_v1, _v3, _v4) | Sign EIP-712 typed data      |
| `eth_getBalance`          | Account balance                          |
| `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_blockNumber` | Read calls and gas |
| `eth_getBlockByNumber`, `eth_getTransactionReceipt`, `eth_getCode` | Chain reads |
| `wallet_switchEthereumChain` | Switch network                        |
| `wallet_addEthereumChain` | Add a custom network                     |

Emitted events: `accountsChanged`, `chainChanged`, `connect`, `disconnect`
plus legacy `networkChanged` and `chainIdChanged`.

## Project structure

```
public/
  manifest.json       # MV3 manifest: popup, content script, service worker
  background.js       # Service worker: wallet state and RPC proxying
  contentScript.js    # Page bridge between injectScript and background
  injectScript.js     # The injected window.ethereum provider
  utils/              # Browser compat, browser utils, RPC utils
src/
  components/         # Popup screens: approvals, settings, accounts
  interfaces/         # Chain and Account types with network config
  wallet-utils/       # Account and transaction helpers (ethers)
  App.tsx             # Popup root
```

## Security notes

- Accounts are stored in extension `localStorage`
  (`mini-wallet-account`), including the private key; the password option
  hashes a password for access control rather than encrypting the key.
- The settings screen can display the private key and a recovery phrase.
  Treat this build as development grade and use test accounts.
- The content script runs at `document_start` on `<all_urls>` and the
  manifest requests `<all_urls>` host permissions.

## License

Apache-2.0 - see [LICENSE](LICENSE) and [NOTICE](NOTICE).
