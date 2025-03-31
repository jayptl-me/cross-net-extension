/**
 * Cross-Net Wallet Content Script
 * 
 * Handles communication between the page's injected provider and the extension background script
 */

// Initialize a connection to the background script
const backgroundConnection = {
  port: null,
  connected: false,
  messageQueue: [],
  callbacks: {},
  
  // Connect to the background script
  connect() {
    try {
      this.port = chrome.runtime.connect({ name: 'crossnet-wallet-content' });
      this.connected = true;
      
      // Set up message handlers
      this.port.onMessage.addListener(this.handleBackgroundMessage.bind(this));
      
      // Handle disconnection
      this.port.onDisconnect.addListener(() => {
        console.log('Content script disconnected from background');
        this.connected = false;
        this.callbacks.connectionLost?.forEach(cb => cb());
        
        // Attempt to reconnect after a delay
        setTimeout(() => this.reconnect(), 1000);
      });
      
      // Process any queued messages
      this.processQueue();
      
      // Notify any listeners that connection is restored
      this.callbacks.connectionRestored?.forEach(cb => cb());
      
      return true;
    } catch (error) {
      console.error('Failed to connect to background script:', error);
      this.connected = false;
      return false;
    }
  },
  
  // Attempt to reconnect to the background script
  reconnect() {
    console.log('Attempting to reconnect to background script...');
    return this.connect();
  },
  
  // Send a message to the background script
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        if (!this.reconnect()) {
          this.messageQueue.push({ message, resolve, reject });
          return;
        }
      }
      
      try {
        const requestId = message.data?.requestId || message.requestId || Date.now().toString();
        
        // Set up a response handler for this message
        const responseHandler = response => {
          if (response.requestId === requestId || 
              (response.data && response.data.requestId === requestId)) {
            this.port.onMessage.removeListener(responseHandler);
            resolve(response);
          }
        };
        
        this.port.onMessage.addListener(responseHandler);
        
        // Send the message
        this.port.postMessage(message);
        
        // Set a timeout to clean up the listener if no response
        setTimeout(() => {
          this.port.onMessage.removeListener(responseHandler);
          reject(new Error('Response timeout'));
        }, 30000);
      } catch (error) {
        console.error('Error sending message to background:', error);
        reject(error);
      }
    });
  },
  
  // Process any queued messages
  processQueue() {
    while (this.messageQueue.length > 0) {
      const { message, resolve, reject } = this.messageQueue.shift();
      this.sendMessage(message).then(resolve).catch(reject);
    }
  },
  
  // Handle messages from the background script
  handleBackgroundMessage(message) {
    // Forward messages from background to the page when appropriate
    if (message.type === 'CROSSNET_STATE_UPDATE' || 
        message.type === 'WALLET_EVENT' ||
        message.type === 'CONNECT' ||
        message.type === 'DISCONNECT') {
      window.postMessage(message, '*');
    }
    
    // Handle transaction responses
    if (message.type === 'SEND_TRANSACTION_RESPONSE') {
      handleTransactionResponse(message);
    }
    
    // Handle sign responses
    if (message.type === 'PERSONAL_SIGN_RESPONSE' || 
        message.type === 'ETH_SIGN_RESPONSE' ||
        message.type === 'TYPED_SIGN_RESPONSE') {
      handleSignResponse(message);
    }
  },
  
  // Add event listener
  addEventListener(event, callback) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
  },
  
  // Remove event listener
  removeEventListener(event, callback) {
    if (!this.callbacks[event]) return;
    this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
  }
};

// Connect to the background script
backgroundConnection.connect();

// Pending request map to track request promises
const pendingRequestsMap = new Map();
let nextRequestId = 1;

// Inject the provider script into the page
function injectProviderScript() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injectScript.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('Wallet provider script injected');
  } catch (err) {
    console.error('Failed to inject provider script:', err);
  }
}

// Higher-order function for context recovery
const withContextRecovery = (fn) => async (...args) => {
  try {
    if (!backgroundConnection.connected) {
      await backgroundConnection.reconnect();
    }
    return await fn(...args);
  } catch (error) {
    console.error('Error in context recovery:', error);
    throw error;
  }
};

// Listen for messages from the page
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  // Handle provider requests
  if (event.data && event.data.type === 'CROSSNET_REQUEST') {
    const { method, params, id } = event.data;
    
    try {
      // Process the request based on method
      let response;
      
      switch (method) {
        case 'eth_requestAccounts':
          response = await handleConnectRequest();
          break;
          
        case 'eth_accounts':
          response = await handleGetAccountsRequest();
          break;
          
        case 'eth_chainId':
          response = await handleGetChainIdRequest();
          break;
          
        case 'eth_sendTransaction':
          response = await handleTransactionRequest(params[0]);
          break;
          
        case 'personal_sign':
          response = await handleSignRequest({ msgData: params[0], address: params[1] }, 'personal');
          break;
          
        case 'eth_sign':
          response = await handleSignRequest({ address: params[0], msgData: params[1] }, 'eth');
          break;
          
        case 'eth_signTypedData_v4':
          response = await handleSignRequest({ address: params[0], typedData: params[1] }, 'typed');
          break;
          
        case 'eth_getBalance':
          response = await handleGetBalanceRequest(params[0], params[1]);
          break;
          
        case 'wallet_switchEthereumChain':
          response = await handleSwitchChainRequest(params[0]);
          break;
          
        case 'wallet_addEthereumChain':
          response = await handleAddChainRequest(params[0]);
          break;
          
        default:
          // Forward other RPC requests to the wallet
          response = await forwardRpcRequest(method, params);
      }
      
      // Send the response back to the page
      window.postMessage({
        type: 'CROSSNET_RESPONSE',
        id,
        result: response,
        success: true
      }, '*');
      
    } catch (error) {
      console.error(`Error processing request ${method}:`, error);
      
      // Format error in a way compatible with EIP-1193
      let errorMessage = error.message || 'Unknown error';
      let errorCode = -32603; // Internal JSON-RPC error
      
      if (errorMessage.includes('user rejected')) {
        errorCode = 4001; // User rejected request
      } else if (errorMessage.includes('not connected')) {
        errorCode = 4100; // Unauthorized
      } else if (errorMessage.includes('chain ID')) {
        errorCode = 4901; // Chain not added
      }
      
      window.postMessage({
        type: 'CROSSNET_RESPONSE',
        id,
        error: {
          code: errorCode,
          message: errorMessage
        },
        success: false
      }, '*');
    }
  }
});

/**
 * Handle connection requests
 */
const handleConnectRequest = withContextRecovery(async function() {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing connect request (ID: ${requestId})`);
    
    // Get site information
    const origin = window.location.origin;
    const favicon = getFavicon();
    const title = document.title || origin;
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Connect request timed out');
        reject(new Error('Connection request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 60000); // 1 minute timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'CONNECT_REQUEST',
        data: {
          origin,
          favicon,
          title,
          requestId
        }
      }).then(response => {
        if (response.success && response.accounts) {
          const accounts = response.accounts;
          const chainId = response.chainId;
          
          // Update our state
          window.crossNetWalletState = {
            connected: true,
            accounts,
            chainId,
            selectedAddress: accounts[0] || null
          };
          
          // Resolve the request
          resolve({
            accounts,
            chainId
          });
          
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.waiting) {
          // Request is waiting for user approval, store it to be resolved later
          pendingRequestsMap.set(requestId, {
            resolve,
            reject,
            timeout,
            timestamp: Date.now()
          });
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        console.error('Error sending connection request:', error);
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleConnectRequest:', error);
    return { error: error.message || 'Failed to process connect request' };
  }
});

/**
 * Handle get accounts request
 */
const handleGetAccountsRequest = withContextRecovery(async function() {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing get accounts request (ID: ${requestId})`);
    
    return new Promise((resolve, reject) => {
      backgroundConnection.sendMessage({
        type: 'GET_ACCOUNTS_REQUEST',
        data: { requestId }
      }).then(response => {
        if (response.accounts) {
          resolve(response.accounts);
        } else {
          resolve([]);  // Return empty array if no accounts or error
        }
      }).catch(error => {
        console.error('Error getting accounts:', error);
        resolve([]);  // Return empty array on error for compatibility
      });
    });
  } catch (error) {
    console.error('Error in handleGetAccountsRequest:', error);
    return [];  // Return empty array on error for compatibility
  }
});

/**
 * Handle get chain ID request
 */
const handleGetChainIdRequest = withContextRecovery(async function() {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing get chainId request (ID: ${requestId})`);
    
    return new Promise((resolve, reject) => {
      backgroundConnection.sendMessage({
        type: 'GET_CHAINID_REQUEST',
        data: { requestId }
      }).then(response => {
        if (response.chainId) {
          resolve(response.chainId);
        } else {
          reject(new Error('Could not get chain ID'));
        }
      }).catch(error => {
        console.error('Error getting chainId:', error);
        reject(error);
      });
    });
  } catch (error) {
    console.error('Error in handleGetChainIdRequest:', error);
    throw error;
  }
});

/**
 * Handle transaction request
 */
const handleTransactionRequest = withContextRecovery(async function(transaction) {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing transaction request (ID: ${requestId})`, transaction);
    
    // Get site information
    const origin = window.location.origin;
    const favicon = getFavicon();
    const title = document.title || origin;
    
    // Prepare the request data
    const requestData = {
      transaction,
      origin,
      favicon,
      title,
      requestId
    };
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Transaction request timed out');
        reject(new Error('Transaction request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 60000); // 1 minute timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'SEND_TRANSACTION_REQUEST',
        data: requestData
      }).then(response => {
        if (response.result) {
          // The transaction was successful
          resolve(response.result);
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.waiting) {
          // Request is waiting for user approval, store it to be resolved later
          pendingRequestsMap.set(requestId, {
            resolve,
            reject,
            timeout,
            timestamp: Date.now()
          });
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleTransactionRequest:', error);
    return { error: error.message || 'Failed to process transaction request' };
  }
});

/**
 * Handle transaction responses from the background
 */
function handleTransactionResponse(message) {
  const { requestId, approved, result, error } = message;
  
  // Look up the pending request
  const pendingRequest = pendingRequestsMap.get(requestId);
  if (!pendingRequest) return;
  
  const { resolve, reject, timeout } = pendingRequest;
  
  // Clear the timeout
  clearTimeout(timeout);
  
  // Resolve or reject the promise
  if (approved && result) {
    resolve(result);
  } else {
    reject(error || new Error('Transaction rejected'));
  }
  
  // Remove from pending requests
  pendingRequestsMap.delete(requestId);
}

/**
 * Handle sign request
 */
const handleSignRequest = withContextRecovery(async function(signData, type) {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing sign request (ID: ${requestId})`, signData, type);
    
    // Get site information
    const origin = window.location.origin;
    const favicon = getFavicon();
    const title = document.title || origin;
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Sign request timed out');
        reject(new Error('Sign request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 60000); // 1 minute timeout
      
      // Determine request type
      const requestType = type === 'typed' ? 'TYPED_SIGN_REQUEST' : 
                          type === 'eth' ? 'ETH_SIGN_REQUEST' : 
                          'PERSONAL_SIGN_REQUEST';
      
      // Send the request
      backgroundConnection.sendMessage({
        type: requestType,
        data: {
          ...signData,
          origin,
          favicon,
          title,
          requestId
        }
      }).then(response => {
        if (response.result) {
          // Sign was successful
          resolve(response.result);
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.waiting) {
          // Request is waiting for user approval, store it to be resolved later
          pendingRequestsMap.set(requestId, {
            resolve,
            reject,
            timeout,
            timestamp: Date.now()
          });
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleSignRequest:', error);
    return { error: error.message || 'Failed to process sign request' };
  }
});

/**
 * Handle sign responses from the background
 */
function handleSignResponse(message) {
  const { requestId, approved, result, error } = message;
  
  // Look up the pending request
  const pendingRequest = pendingRequestsMap.get(requestId);
  if (!pendingRequest) return;
  
  const { resolve, reject, timeout } = pendingRequest;
  
  // Clear the timeout
  clearTimeout(timeout);
  
  // Resolve or reject the promise
  if (approved && result) {
    resolve(result);
  } else {
    reject(error || new Error('Signing rejected'));
  }
  
  // Remove from pending requests
  pendingRequestsMap.delete(requestId);
}

/**
 * Handle get balance request
 */
const handleGetBalanceRequest = withContextRecovery(async function(address, blockTag = 'latest') {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing get balance request (ID: ${requestId}) for ${address}`);
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Get balance request timed out');
        reject(new Error('Get balance request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 30000); // 30 second timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'GET_BALANCE_REQUEST',
        data: {
          address,
          blockTag,
          requestId
        }
      }).then(response => {
        if (response.result !== undefined) {
          // Got balance successfully
          resolve(response.result);
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleGetBalanceRequest:', error);
    return { error: error.message || 'Failed to process get balance request' };
  }
});

/**
 * Forward general RPC requests to the wallet
 */
const forwardRpcRequest = withContextRecovery(async function(method, params) {
  try {
    const requestId = nextRequestId++;
    console.log(`Forwarding RPC request (ID: ${requestId}): ${method}`, params);
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('RPC request timed out');
        reject(new Error('RPC request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 30000); // 30 second timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'RPC_REQUEST',
        data: {
          method,
          params,
          requestId
        }
      }).then(response => {
        if (response.result !== undefined) {
          // Got result successfully
          resolve(response.result);
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in forwardRpcRequest:', error);
    return { error: error.message || 'Failed to process RPC request' };
  }
});

/**
 * Handle switch chain request
 */
const handleSwitchChainRequest = withContextRecovery(async function(switchParams) {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing switch chain request (ID: ${requestId})`, switchParams);
    
    const chainId = switchParams.chainId;
    
    // Get site information
    const origin = window.location.origin;
    const favicon = getFavicon();
    const title = document.title || origin;
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Switch chain request timed out');
        reject(new Error('Switch chain request timed out'));
        pendingRequestsMap.delete(requestId);
      }, 60000); // 1 minute timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'SWITCH_CHAIN_REQUEST',
        data: {
          chainId,
          origin,
          favicon,
          title,
          requestId
        }
      }).then(response => {
        if (response.success) {
          // Chain was switched successfully
          resolve(null); // Per EIP-3326, successful switch returns null
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.waiting) {
          // Request is waiting for user approval, store it to be resolved later
          pendingRequestsMap.set(requestId, {
            resolve,
            reject,
            timeout,
            timestamp: Date.now()
          });
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleSwitchChainRequest:', error);
    return { error: error.message || 'Failed to process switch chain request' };
  }
});

/**
 * Handle add chain request
 */
const handleAddChainRequest = withContextRecovery(async function(chainData) {
  try {
    const requestId = nextRequestId++;
    console.log(`Processing add chain request (ID: ${requestId})`, chainData);
    
    // Get site information
    const origin = window.location.origin;
    const favicon = getFavicon();
    const title = document.title || origin;
    
    return new Promise((resolve, reject) => {
      // Set a timeout
      const timeout = setTimeout(() => {
        console.log('Add chain request timed out');
        pendingRequestsMap.delete(requestId);
        reject(new Error('Add chain request timed out'));
      }, 60000); // 1 minute timeout
      
      // Send the request
      backgroundConnection.sendMessage({
        type: 'ADD_CHAIN_REQUEST',
        data: {
          chainData,
          origin,
          favicon,
          title,
          requestId
        }
      }).then(response => {
        if (response.success) {
          // Chain was added successfully
          resolve(null); // Per EIP-3085, successful add chain returns null
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else if (response.waiting) {
          // Request is waiting for user approval, store it to be resolved later
          pendingRequestsMap.set(requestId, {
            resolve,
            reject,
            timeout,
            timestamp: Date.now()
          });
        } else if (response.error) {
          // There was an error processing the request
          reject(new Error(response.error));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        } else {
          // Unknown response
          reject(new Error('Invalid response from wallet'));
          clearTimeout(timeout);
          pendingRequestsMap.delete(requestId);
        }
      }).catch(error => {
        reject(error);
        clearTimeout(timeout);
        pendingRequestsMap.delete(requestId);
      });
    });
  } catch (error) {
    console.error('Error in handleAddChainRequest:', error);
    return { error: error.message || 'Failed to process add chain request' };
  }
});

/**
 * Helper to get the favicon URL
 */
function getFavicon() {
  const favicon = document.querySelector('link[rel="icon"]') ||
                 document.querySelector('link[rel="shortcut icon"]');
  return favicon ? favicon.href : '';
}

/**
 * Function to reconnect to extension
 */
function reconnectToExtension() {
  backgroundConnection.connect();
}

// Handle messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    // Transaction response
    case 'SEND_TRANSACTION_RESPONSE': {
      handleTransactionResponse(message);
      sendResponse({ success: true });
      break;
    }
    
    // Sign response
    case 'PERSONAL_SIGN_RESPONSE':
    case 'ETH_SIGN_RESPONSE':
    case 'TYPED_SIGN_RESPONSE': {
      handleSignResponse(message);
      sendResponse({ success: true });
      break;
    }
    
    // Chain response
    case 'SWITCH_CHAIN_RESPONSE':
    case 'ADD_CHAIN_RESPONSE': {
      const { requestId, approved, error } = message;
      const pendingRequest = pendingRequestsMap.get(requestId);
      
      if (pendingRequest) {
        const { resolve, reject, timeout } = pendingRequest;
        clearTimeout(timeout);
        
        if (approved) {
          resolve(null); // Per EIP specs, return null on success
        } else {
          reject(new Error(error || 'Request rejected'));
        }
        
        pendingRequestsMap.delete(requestId);
      }
      
      sendResponse({ success: true });
      break;
    }
    
    // State update
    case 'CROSSNET_STATE_UPDATE': {
      // Forward to page
      window.postMessage({
        type: 'CROSSNET_STATE_UPDATE',
        data: message.data
      }, '*');
      
      sendResponse({ success: true });
      break;
    }
    
    // Connect notification
    case 'CONNECT': {
      // Update extension state
      window.crossNetWalletState = {
        ...window.crossNetWalletState,
        connected: true,
        accounts: message.accounts || [],
        chainId: message.chainId,
        selectedAddress: (message.accounts && message.accounts[0]) || null
      };
      
      // Notify page about the update
      window.postMessage({
        type: 'WALLET_EVENT',
        eventName: 'connect',
        eventData: { chainId: message.chainId }
      }, '*');
      
      sendResponse({ success: true });
      break;
    }
    
    // Disconnect notification
    case 'DISCONNECT': {
      // Update extension state
      window.crossNetWalletState = {
        ...window.crossNetWalletState,
        connected: false,
        accounts: [],
        selectedAddress: null
      };
      
      // Notify page about the update
      window.postMessage({
        type: 'CROSSNET_STATE_UPDATE',
        data: window.crossNetWalletState
      }, '*');
      
      // Also send explicit wallet event
      window.postMessage({
        type: 'WALLET_EVENT',
        eventName: 'disconnect',
        eventData: { code: 1000, reason: 'Connection closed by wallet' }
      }, '*');
      
      sendResponse({ success: true });
      break;
    }
    
    // Forward generic wallet events
    case 'WALLET_EVENT': {
      // Forward the event to the page
      window.postMessage({
        type: 'WALLET_EVENT',
        eventName: message.eventName,
        eventData: message.eventData
      }, '*');
      
      sendResponse({ success: true });
      break;
    }
    
    default:
      return false;
  }
  
  return true;
});

// Inject the provider script as soon as possible
injectProviderScript();

// Handle connection errors and reconnection
backgroundConnection.addEventListener('connectionLost', () => {
  console.warn('Connection to wallet extension lost');
  setTimeout(reconnectToExtension, 1000);
});

backgroundConnection.addEventListener('connectionRestored', () => {
  console.log('Connection to wallet extension restored');
});

// Log that the content script has loaded
console.log('Cross-Net Wallet content script loaded');