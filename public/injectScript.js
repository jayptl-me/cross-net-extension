/**
 * Cross-Net Wallet Provider Script
 * 
 * This script is injected into web pages to provide a wallet interface
 * that follows EIP-1193 and EIP-6963 standards for dApp connectivity.
 */

// Initialize provider
window.addEventListener('load', injectProvider);
document.addEventListener('DOMContentLoaded', injectProvider);

// Standard Ethereum RPC error codes
const ERROR_CODES = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  METHOD_NOT_FOUND: -32601,
  INVALID_REQUEST: -32600,
  RESOURCE_UNAVAILABLE: -32002,
  RESOURCE_NOT_FOUND: -32001
};

function injectProvider() {
  // Only inject once
  if (window.crossNetWallet) return;

  console.log('Injecting Cross-Net Wallet provider...');

  // Create the provider that follows EIP-1193 standard
  const crossNetWallet = {
    isConnected: false,
    accounts: [],
    chainId: null,
    selectedAddress: null, // Added for compatibility
    networkVersion: null, // Added for compatibility
    isUnlocked: true, // Assume wallet is unlocked initially
    connected: false, // Explicit connection state
    _isConnecting: false, // Flag to track connection in progress
    _chainSwitchInProgress: false, // Flag to track chain switch in progress
    _maxRetries: 3, // Maximum number of retries for RPC calls
    _requestId: 1, // Request counter for legacy methods
    _pendingRequests: new Map(), // For tracking legacy method requests

    /**
     * Create standardized RPC error objects
     * @param {number} code - Error code
     * @param {string} message - Error message
     * @param {*} data - Additional error data
     * @returns {Error} - Standard RPC error object
     */
    _createRPCError(code, message, data) {
      const error = new Error(message);
      error.code = code;
      error.data = data;
      return error;
    },
    
    // Core methods following EIP-1193 standard
    async request({ method, params }) {
      console.log(`Wallet request: ${method}`, params);
      // Critical standard methods
      switch (method) {
        case 'eth_requestAccounts':
          return this.connect();
        case 'eth_accounts':
          return this.getAccounts();
        case 'eth_chainId':
          return this.getChainId();
        case 'eth_sendTransaction':
          return this.sendTransaction(params[0]);
        case 'personal_sign':
          return this.personalSign(params[0], params[1]);
        case 'eth_signTransaction':
          return this.signTransaction(params[0]);
        case 'eth_getBalance':
          return this.getBalance(params[0], params[1]);
        case 'wallet_switchEthereumChain':
          return this.switchChain(params[0].chainId);
        case 'wallet_addEthereumChain':
          return this.addChain(params[0]);
        case 'eth_sign':
          return this.ethSign(params[0], params[1]);
        case 'eth_signTypedData':
        case 'eth_signTypedData_v1':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4':
          return this.signTypedData(params[0], params[1]);
        case 'net_version':
          return this.getNetVersion();
        case 'eth_getBlockByNumber':
        case 'eth_getTransactionReceipt':
        case 'eth_getCode':
        case 'eth_call':
        case 'eth_estimateGas':
        case 'eth_gasPrice':
        case 'eth_blockNumber':
          // Handle common read operations
          return this._sendRequest(method, params);
        // Handle other methods by forwarding to background
        default:
          return this._sendRequest(method, params);
      }
    },
    
    // Core wallet functions
    async connect() {
      try {
        console.log('Requesting accounts connection...');
        const response = await this._sendRequest('eth_requestAccounts', []);
        
        if (response.accounts && response.accounts.length) {
          this.accounts = response.accounts;
          this.selectedAddress = response.accounts[0]; // Update selected address for compatibility
          this.chainId = response.chainId;
          this.networkVersion = parseInt(response.chainId, 16).toString(); // Add network version
          this.isConnected = true;
          this.connected = true; // Update both connection state flags
          
          // Emit connected event for listeners
          this.emit('accountsChanged', this.accounts);
          this.emit('chainChanged', this.chainId);
          this.emit('connect', { chainId: this.chainId });
          
          console.log('Wallet connected successfully:', this.accounts);
        }
        
        return this.accounts;
      } catch (error) {
        console.error('Connection error:', error);
        throw error;
      }
    },
    
    async getAccounts() {
      try {
        const response = await this._sendRequest('eth_accounts', []);
        this.accounts = response.result || [];
        return this.accounts;
      } catch (error) {
        console.error('Get accounts error:', error);
        return [];
      }
    },
    
    async getChainId() {
      try {
        const response = await this._sendRequest('eth_chainId', []);
        this.chainId = response.result;
        return this.chainId;
      } catch (error) {
        console.error('Get chainId error:', error);
        return null;
      }
    },
    
    async getNetVersion() {
      try {
        // Some dApps use net_version instead of eth_chainId
        const response = await this._sendRequest('net_version', []);
        return response.result;
      } catch (error) {
        console.error('Get network version error:', error);
        // If error, try to return chainId as fallback
        return this.chainId ? parseInt(this.chainId).toString() : null;
      }
    },
    
    // Transaction methods
    async sendTransaction(txParams) {
      if (!this.isConnected) {
        throw this._createRPCError(
          ERROR_CODES.UNAUTHORIZED, 
          'Wallet not connected. Connect first using eth_requestAccounts'
        );
      }
      
      try {
        console.log('Sending transaction:', txParams);
        const response = await this._sendRequest('eth_sendTransaction', [txParams]);
        console.log('Transaction response:', response);
        
        // Return just the transaction hash as per standard for eth_sendTransaction
        return response.result;
      } catch (error) {
        console.error('Send transaction error:', error);
        throw error;
      }
    },
    
    async signTransaction(txParams) {
      if (!this.isConnected) {
        throw this._createRPCError(
          ERROR_CODES.UNAUTHORIZED, 
          'Wallet not connected. Connect first using eth_requestAccounts'
        );
      }
      
      try {
        console.log('Signing transaction:', txParams);
        const response = await this._sendRequest('eth_signTransaction', [txParams]);
        return response.result;
      } catch (error) {
        console.error('Sign transaction error:', error);
        throw error;
      }
    },
    
    async getBalance(address, blockTag) {
      try {
        const params = [address || this.accounts[0], blockTag || 'latest'];
        const response = await this._sendRequest('eth_getBalance', params);
        return response.result;
      } catch (error) {
        console.error('Get balance error:', error);
        throw error;
      }
    },
    
    async personalSign(data, address) {
      if (!this.isConnected) {
        throw new Error('Wallet not connected');
      }
      
      try {
        console.log('Personal signing data:', { data, address });
        const response = await this._sendRequest('personal_sign', [data, address]);
        return response.result;
      } catch (error) {
        console.error('Personal sign error:', error);
        throw error;
      }
    },
    
    async ethSign(address, data) {
      if (!this.isConnected) {
        throw new Error('Wallet not connected');
      }
      
      try {
        console.log('Eth signing data:', { address, data });
        const response = await this._sendRequest('eth_sign', [address, data]);
        return response.result;
      } catch (error) {
        console.error('Eth sign error:', error);
        throw error;
      }
    },
    
    async signTypedData(address, typedData) {
      if (!this.isConnected) {
        throw new Error('Wallet not connected');
      }
      
      try {
        console.log('Signing typed data:', { address, typedData });
        const response = await this._sendRequest('eth_signTypedData_v4', [address, typedData]);
        return response.result;
      } catch (error) {
        console.error('Sign typed data error:', error);
        throw error;
      }
    },
    
    async switchChain(chainId) {
      try {
        if (this._chainSwitchInProgress) {
          throw this._createRPCError(
            ERROR_CODES.RESOURCE_UNAVAILABLE,
            'Chain switch already in progress'
          );
        }
        
        this._chainSwitchInProgress = true;
        console.log('Switching chain to:', chainId);
        
        const response = await this._sendRequest('wallet_switchEthereumChain', [{ chainId }]);
        
        if (response.success) {
          // Update local state
          const oldChainId = this.chainId;
          this.chainId = chainId;
          this.networkVersion = parseInt(chainId, 16).toString();
          
          // Only emit if the chain actually changed
          if (oldChainId !== chainId) {
            this.emit('chainChanged', chainId);
            
            // Some dApps expect formatted or decimal versions
            this.emit('networkChanged', parseInt(chainId, 16).toString());
            this.emit('chainIdChanged', chainId);
          }
        }
        
        this._chainSwitchInProgress = false;
        return null; // Successful chain switches return null per EIP-3326
      } catch (error) {
        this._chainSwitchInProgress = false;
        console.error('Switch chain error:', error);
        
        // If chain doesn't exist, throw the specific error for wallets to catch (4902)
        if (error.code === 4902) {
          throw error; // Let dApps handle this to suggest adding the chain
        }
        
        throw error;
      }
    },
    
    async addChain(chainData) {
      try {
        if (this._chainSwitchInProgress) {
          throw this._createRPCError(
            ERROR_CODES.RESOURCE_UNAVAILABLE,
            'Chain operation already in progress'
          );
        }
        
        this._chainSwitchInProgress = true;
        console.log('Adding chain:', chainData);
        
        // Validate required chain data properties
        if (!chainData.chainId || !chainData.chainName || !chainData.rpcUrls || chainData.rpcUrls.length === 0) {
          throw this._createRPCError(
            ERROR_CODES.INVALID_PARAMS,
            'Invalid chain data: chainId, chainName, and rpcUrls are required'
          );
        }
        
        const response = await this._sendRequest('wallet_addEthereumChain', [chainData]);
        
        // Chain added successfully, now check if we should switch to it
        if (response.success && response.switched) {
          // Auto-switch occurred
          const oldChainId = this.chainId;
          this.chainId = chainData.chainId;
          this.networkVersion = parseInt(chainData.chainId, 16).toString();
          
          if (oldChainId !== chainData.chainId) {
            this.emit('chainChanged', chainData.chainId);
            this.emit('networkChanged', parseInt(chainData.chainId, 16).toString());
          }
        }
        
        this._chainSwitchInProgress = false;
        return null; // Successful chain additions return null per EIP-3085
      } catch (error) {
        this._chainSwitchInProgress = false;
        console.error('Add chain error:', error);
        throw error;
      }
    },
    
    // Private method to handle sending requests to content script
    _sendRequest(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = Date.now() + Math.random().toString().slice(2);
        let retryCount = 0;
        
        const makeRequest = () => {
          const timeout = setTimeout(() => {
            if (retryCount < this._maxRetries) {
              console.log(`Request timeout, retrying (${retryCount + 1}/${this._maxRetries})...`);
              retryCount++;
              makeRequest();
            } else {
              const error = this._createRPCError(
                ERROR_CODES.DISCONNECTED, 
                'Request timeout after multiple retries'
              );
              window.removeEventListener('message', responseHandler);
              reject(error);
              
              // Emit disconnect event when we can't reach the wallet
              if (this.isConnected) {
                this.isConnected = false;
                this.emit('disconnect', error);
              }
            }
          }, 20000); // 20-second timeout before retry
          
          // Handler for receiving the response
          const responseHandler = (event) => {
            if (
              event.data &&
              event.data.type === 'CROSSNET_RESPONSE' &&
              event.data.id === requestId
            ) {
              clearTimeout(timeout);
              window.removeEventListener('message', responseHandler);
              
              if (event.data.error) {
                const errorObj = typeof event.data.error === 'string' 
                  ? { message: event.data.error } 
                  : event.data.error;
                  
                const error = this._createRPCError(
                  errorObj.code || ERROR_CODES.INTERNAL_ERROR,
                  errorObj.message || 'Unknown error',
                  errorObj.data
                );
                
                // Special handling for chain disconnected errors
                if (error.code === ERROR_CODES.CHAIN_DISCONNECTED) {
                  this.emit('chainChanged', null);
                }
                
                // Special handling for user rejection
                if (error.code === ERROR_CODES.USER_REJECTED) {
                  console.log('User rejected the request');
                }
                
                reject(error);
              } else {
                resolve(event.data);
              }
            }
          };
          
          window.addEventListener('message', responseHandler);
          
          // Send the request to the content script
          window.postMessage(
            {
              type: 'CROSSNET_REQUEST',
              method,
              params,
              id: requestId
            },
            '*'
          );
        };
        
        makeRequest();
      });
    },
    
    // Event management
    _events: {},
    
    on(eventName, listener) {
      if (!this._events[eventName]) {
        this._events[eventName] = [];
      }
      this._events[eventName].push(listener);
      return () => this.removeListener(eventName, listener);
    },
    
    removeListener(eventName, listener) {
      if (!this._events[eventName]) return;
      this._events[eventName] = this._events[eventName].filter(l => l !== listener);
    },
    
    emit(eventName, ...args) {
      if (!this._events[eventName]) return;
      this._events[eventName].forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in ${eventName} event listener:`, error);
        }
      });
    }
  };
  
  // Install the provider
  window.crossNetWallet = crossNetWallet;
  
  // For compatibility with existing dApps that look for window.ethereum
  if (!window.ethereum) {
    window.ethereum = crossNetWallet;
  } else {
    console.warn('Another ethereum provider detected, not overriding window.ethereum');
    // Attempt to patch into multi-provider environment
    if (Array.isArray(window.ethereum.providers)) {
      window.ethereum.providers.push(crossNetWallet);
    }
  }
  
  // Add necessary properties that some dApps check for
  crossNetWallet.isMetaMask = false;
  crossNetWallet.isCrossNet = true;
  crossNetWallet._metamask = { isUnlocked: () => Promise.resolve(true) }; // For backward compatibility
  
  // Register for EIP-6963 multi-wallet standard
  window.addEventListener('eip6963:requestProvider', announceProvider);
  
  // Automatically announce provider for multi-wallet environments
  setTimeout(announceProvider, 100);
  
  // Add EIP-6963 support for multi-wallet detection
  function announceProvider() {
    console.log('Announcing Cross-Net Wallet provider to dApp');
    
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: {
          info: {
            uuid: 'a6708e1d-2574-4f03-8f98-c641a4cf12be',
            name: 'Cross-Net Wallet',
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTAgMjBDMTUuNTIyOSAyMCAyMCAxNS41MjI5IDIwIDEwQzIwIDQuNDc3MTUgMTUuNTIyOSAwIDEwIDBDNC40NzcxNSAwIDAgNC40NzcxNSAwIDEwQzAgMTUuNTIyOSA0LjQ3NzE1IDIwIDEwIDIwWiIgZmlsbD0iIzA1NjJDMyIvPjxwYXRoIGQ9Ik0xNCAxNkgxMkw5IDEwTDYgMTZINEw4IDhIMTBMMTQgMTZaIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==',
            description: 'Cross-chain wallet for Web3 applications',
            rdns: 'com.crossnet.wallet'
          },
          provider: crossNetWallet
        }
      })
    );
  }
  
  // Handle state updates from the wallet
  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'CROSSNET_STATE_UPDATE') {
      const state = event.data.data;
      
      // Update local state
      const accountsChanged = 
        !crossNetWallet.accounts || 
        !state.accounts ||
        crossNetWallet.accounts.join(',') !== state.accounts.join(',');
        
      const chainChanged = crossNetWallet.chainId !== state.chainId;
      
      // Update the provider state
      crossNetWallet.isConnected = state.connected;
      crossNetWallet.accounts = state.accounts || [];
      crossNetWallet.chainId = state.chainId;
      
      // Emit events for state changes
      if (accountsChanged) {
        crossNetWallet.emit('accountsChanged', crossNetWallet.accounts);
      }
      
      if (chainChanged) {
        crossNetWallet.emit('chainChanged', crossNetWallet.chainId);
      }
    }
    
    // Handle specific wallet events
    if (event.data && event.data.type === 'WALLET_EVENT') {
      const { eventName, eventData } = event.data;
      crossNetWallet.emit(eventName, eventData);
    }
  });
  
  // Force announce provider one more time after a slight delay
  // This helps with sites that load wallet detection later
  setTimeout(() => {
    announceProvider();
    
    // Also make a manual connection attempt for sites that expect window.ethereum to be always connected
    if (crossNetWallet.accounts.length === 0) {
      crossNetWallet.getAccounts().catch(e => console.warn('Initial accounts check failed:', e));
    }
    
    // Perform a health check to verify wallet connectivity
    performHealthCheck();
  }, 1000);
  
  // Health check function to verify wallet connectivity
  async function performHealthCheck() {
    try {
      // Check if we can communicate with the wallet
      const chainIdResponse = await crossNetWallet._sendRequest('eth_chainId', []);
      if (chainIdResponse && chainIdResponse.result) {
        console.log('Wallet health check successful, current chain:', chainIdResponse.result);
        
        // Set chain ID if it wasn't already set
        if (!crossNetWallet.chainId) {
          crossNetWallet.chainId = chainIdResponse.result;
          crossNetWallet.networkVersion = parseInt(chainIdResponse.result, 16).toString();
        }
        
        // Now check for accounts if we're not connected
        if (!crossNetWallet.isConnected || crossNetWallet.accounts.length === 0) {
          const accountsResponse = await crossNetWallet._sendRequest('eth_accounts', []);
          if (accountsResponse && accountsResponse.result && accountsResponse.result.length > 0) {
            crossNetWallet.accounts = accountsResponse.result;
            crossNetWallet.selectedAddress = accountsResponse.result[0];
            crossNetWallet.isConnected = true;
            crossNetWallet.emit('accountsChanged', crossNetWallet.accounts);
            console.log('Wallet automatically connected with accounts:', crossNetWallet.accounts);
          }
        }
      }
    } catch (error) {
      console.warn('Wallet health check failed:', error);
      // Don't emit disconnect here as it might be premature
    }
  }
  
  // Log that provider was injected
  console.log('Cross-Net Wallet provider injected successfully');
}
