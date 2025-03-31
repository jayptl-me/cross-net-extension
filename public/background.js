/**
 * Cross-Net Wallet Background Script
 * 
 * This script runs in the background and is responsible for:
 * 1. Managing wallet state and storage
 * 2. Processing connection requests from websites
 * 3. Handling transaction signing and approval
 * 4. Communication between content scripts and the extension UI
 */

// Browser compatibility layer - determines if we're in Chrome or Firefox
const browserAPI = (function() {
  const api = {};
  
  // Is this Firefox?
  const isFirefox = typeof browser !== 'undefined';
  
  // Storage API
  api.storage = {
    local: {
      get: function(keys, callback) {
        if (isFirefox) {
          browser.storage.local.get(keys).then(callback);
        } else {
          chrome.storage.local.get(keys, callback);
        }
      },
      set: function(items, callback) {
        if (isFirefox) {
          browser.storage.local.set(items).then(() => {
            if (callback) callback();
          }).catch(error => {
            console.error('Storage error:', error);
            if (callback) callback();
          });
        } else {
          chrome.storage.local.set(items, callback);
        }
      },
      remove: function(keys, callback) {
        if (isFirefox) {
          browser.storage.local.remove(keys).then(() => {
            if (callback) callback();
          });
        } else {
          chrome.storage.local.remove(keys, callback);
        }
      }
    }
  };
  
  // Tabs API
  api.tabs = {
    query: function(queryInfo, callback) {
      if (isFirefox) {
        browser.tabs.query(queryInfo).then(callback);
      } else {
        chrome.tabs.query(queryInfo, callback);
      }
    },
    sendMessage: function(tabId, message, callback) {
      if (isFirefox) {
        browser.tabs.sendMessage(tabId, message).then(callback).catch(error => {
          console.warn(`Error sending message to tab ${tabId}:`, error);
          if (callback) callback();
        });
      } else {
        chrome.tabs.sendMessage(tabId, message, callback);
      }
    },
    create: function(createProperties, callback) {
      if (isFirefox) {
        browser.tabs.create(createProperties).then(callback);
      } else {
        chrome.tabs.create(createProperties, callback);
      }
    }
  };
  
  // Windows API
  api.windows = {
    create: function(createProperties, callback) {
      if (isFirefox) {
        browser.windows.create(createProperties).then(callback).catch(error => {
          console.error('Error creating window:', error);
          if (callback) callback();
        });
      } else {
        chrome.windows.create(createProperties, callback);
      }
    }
  };
  
  // Runtime API
  api.runtime = {
    getURL: function(path) {
      return isFirefox ? browser.runtime.getURL(path) : chrome.runtime.getURL(path);
    },
    sendMessage: function(message, callback) {
      if (isFirefox) {
        browser.runtime.sendMessage(message).then(callback).catch(error => {
          console.warn('Error sending runtime message:', error);
          if (callback) callback();
        });
      } else {
        chrome.runtime.sendMessage(message, callback);
      }
    },
    lastError: isFirefox ? browser.runtime.lastError : chrome.runtime.lastError,
    onMessage: isFirefox ? browser.runtime.onMessage : chrome.runtime.onMessage
  };
  
  // Feature detection for WebHID
  api.hasWebHID = typeof navigator !== 'undefined' && 'hid' in navigator;
  
  return api;
})();

// Caching layer for RPC requests
const rpcCache = {
  cache: new Map(),
  
  // Set a value in the cache with optional TTL (time to live in ms)
  set: function(key, value, ttl = 30000) { // Default 30 second TTL
    const entry = {
      value,
      expiry: ttl ? Date.now() + ttl : null
    };
    this.cache.set(key, entry);
    return value;
  },
  
  // Get a value from the cache, returns undefined if expired or not found
  get: function(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (entry.expiry && entry.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  },
  
  // Check if a key exists and is valid
  has: function(key) {
    return this.get(key) !== undefined;
  },
  
  // Clear entire cache or specific key
  clear: function(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  },
  
  // Generate a cache key from method and parameters
  getCacheKey: function(method, params) {
    return `${method}:${JSON.stringify(params || [])}`;
  },
  
  // Process an RPC request through the cache
  async processRequest(method, params, fetchCallback, ttl) {
    // Methods that should never be cached
    const nonCacheableMethods = [
      'eth_sendTransaction',
      'eth_sendRawTransaction',
      'eth_sign',
      'personal_sign',
      'eth_signTypedData',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain'
    ];
    
    // Skip caching for non-cacheable methods
    if (nonCacheableMethods.includes(method)) {
      return fetchCallback();
    }
    
    const cacheKey = this.getCacheKey(method, params);
    
    // Check cache first
    if (this.has(cacheKey)) {
      console.log(`Cache hit for ${method}`);
      return this.get(cacheKey);
    }
    
    // Cache miss, fetch the data
    console.log(`Cache miss for ${method}`);
    const result = await fetchCallback();
    
    // Store in cache
    this.set(cacheKey, result, ttl);
    return result;
  }
};

// Extension state
let state = {
  isUnlocked: true, // Default to unlocked state for now since locking isn't fully implemented
  accounts: [],
  selectedChainId: null,
  pendingRequests: [],
  connectedSites: {}, // {origin: {origin, accounts, chainId, connected, permissions}}
  sessions: {}, // Track dApp connections and their last activity
  lastAccessed: Date.now(), // Track last wallet access time
  customTokens: {}, // Store custom tokens added by dApps
  customChains: {} // Store custom chains added by dApps
};

// Initialize state from storage
browserAPI.storage.local.get(['state', 'connectedSites', 'account', 'sessions', 'customTokens', 'customChains'], (result) => {
  if (result.state) {
    state = { ...state, ...result.state };
  }
  
  if (result.connectedSites) {
    state.connectedSites = result.connectedSites;
  }
  
  if (result.sessions) {
    state.sessions = result.sessions;
  }
  
  if (result.customTokens) {
    state.customTokens = result.customTokens;
  }
  
  if (result.customChains) {
    state.customChains = result.customChains;
  }
  
  // If we have an account, make sure we're in unlocked state
  if (result.account) {
    try {
      const account = JSON.parse(result.account);
      // Set the account address in state
      state.accounts = [account.address];
      // Ensure wallet is unlocked
      state.isUnlocked = true;
    } catch (e) {
      console.error('Error parsing account data:', e);
    }
  }
  
  console.log('Wallet state initialized:', state);
});

/**
 * Save the current state to chrome.storage
 * This is crucial for persistence between browser sessions
 */
function saveState() {
  browserAPI.storage.local.set({ state: {
    isUnlocked: state.isUnlocked,
    accounts: state.accounts,
    selectedChainId: state.selectedChainId,
    lastAccessed: state.lastAccessed,
  }}, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Failed to save state:', browserAPI.runtime.lastError);
    }
  });
}

/**
 * Save connected sites to chrome.storage
 */
function saveConnectedSites() {
  browserAPI.storage.local.set({ connectedSites: state.connectedSites }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Failed to save connected sites:', browserAPI.runtime.lastError);
    }
  });
}

/**
 * Save custom tokens to chrome.storage
 */
function saveCustomTokens() {
  browserAPI.storage.local.set({ customTokens: state.customTokens }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Failed to save custom tokens:', browserAPI.runtime.lastError);
    }
  });
}

/**
 * Save custom chains to chrome.storage
 */
function saveCustomChains() {
  browserAPI.storage.local.set({ customChains: state.customChains }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Failed to save custom chains:', browserAPI.runtime.lastError);
    }
  });
}

/**
 * Open the wallet popup to handle a user approval request
 * @param {string} requestType - The type of request (connect, transaction, sign, etc.)
 * @param {string} requestId - The unique ID of the request
 */
function openPopupForApproval(requestType, requestId) {
  console.log(`Opening popup for ${requestType} approval with requestId: ${requestId}`);
  
  const width = 375;
  const height = 600;
  
  // Build the popup URL with query parameters
  const popupUrl = browserAPI.runtime.getURL(`index.html?requestType=${requestType}&requestId=${requestId}`);
  
  // First try to create a popup window (preferred UX)
  browserAPI.windows.create({
    url: popupUrl,
    type: 'popup',
    width: width,
    height: height,
    left: 100, // Fixed position for better reliability
    top: 100,
    focused: true
  }, (newWindow) => {
    if (browserAPI.runtime.lastError) {
      console.error('Failed to create popup:', browserAPI.runtime.lastError);
      // If popup fails, open in a new tab as fallback
      browserAPI.tabs.create({ url: popupUrl });
    } else {
      console.log('Popup created successfully:', newWindow);
    }
  });
}

/**
 * Notify connected sites about events (like account changes, chain changes)
 * @param {string} origin - The site's origin to notify
 * @param {string} eventName - Name of the event (accountsChanged, chainChanged)
 * @param {any} data - Data to send with the event
 */
function notifyConnectedSite(origin, eventName, data) {
  browserAPI.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      // Only send to tabs that match the origin
      if (tab.url && tab.url.includes(origin)) {
        browserAPI.tabs.sendMessage(tab.id, {
          type: 'WALLET_EVENT',
          eventName,
          eventData: data
        }, (response) => {
          const error = browserAPI.runtime.lastError;
          if (error) {
            console.warn(`Error sending notification to ${origin}:`, error.message);
          } else {
            console.log(`Notified ${origin} about ${eventName} event`);
          }
        });
      }
    });
  });
}

/**
 * Handle messages from content scripts or the popup
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, message);
  
  // Handle logout request
  if (message.type === 'LOGOUT') {
    // Clear account state and connected sites
    state.accounts = [];
    state.isUnlocked = false;
    
    // Notify all connected sites
    Object.keys(state.connectedSites).forEach(site => {
      if (state.connectedSites[site].connected) {
        notifyConnectedSite(site, 'accountsChanged', []);
        notifyConnectedSite(site, 'disconnect', { 
          code: 1000, 
          message: 'User logged out of wallet' 
        });
      }
    });
    
    // Clear connected sites and save state
    state.connectedSites = {};
    saveConnectedSites();
    saveState();
    sendResponse({ success: true });
    return;
  }
  
  // Handle chain change notification
  if (message.type === 'CHAIN_CHANGED') {
    state.selectedChainId = message.chainId;
    saveState();
    
    // Notify all connected sites
    Object.keys(state.connectedSites).forEach(site => {
      if (state.connectedSites[site].connected) {
        notifyConnectedSite(site, 'chainChanged', message.chainId);
      }
    });
    return;
  }
  
  // Handle connection approvals/rejections
  if (message.type === 'APPROVE_CONNECT') {
    const { requestId, approved } = message;
    handleConnectResponse({ requestId, approved });
    sendResponse({ success: true });
    return;
  }
  
  // Handle transaction approvals/rejections
  if (message.type === 'APPROVE_TRANSACTION') {
    const { requestId, approved } = message;
    handleTransactionResponse({ requestId, approved });
    sendResponse({ success: true });
    return;
  }
  
  // Handle connection requests
  if (message.type === 'CONNECT_REQUEST') {
    handleConnectRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle eth_accounts requests
  if (message.type === 'GET_ACCOUNTS_REQUEST') {
    handleGetAccountsRequest(message, sender, sendResponse);
    return;
  }
  
  // Handle eth_chainId requests
  if (message.type === 'GET_CHAINID_REQUEST') {
    handleGetChainIdRequest(message, sender, sendResponse);
    return;
  }
  
  // Handle eth_sendTransaction requests
  if (message.type === 'SEND_TRANSACTION_REQUEST') {
    handleSendTransactionRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle eth_signTransaction requests
  if (message.type === 'SIGN_TRANSACTION_REQUEST') {
    handleSignTransactionRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle eth_getBalance requests
  if (message.type === 'GET_BALANCE_REQUEST') {
    handleGetBalanceRequest(message, sender, sendResponse);
    return;
  }
  
  // Handle personal_sign requests
  if (message.type === 'PERSONAL_SIGN_REQUEST') {
    handlePersonalSignRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle eth_sign requests
  if (message.type === 'ETH_SIGN_REQUEST') {
    handleEthSignRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle typed data signing requests
  if (message.type === 'TYPED_SIGN_REQUEST') {
    handleTypedSignRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle wallet_watchAsset requests
  if (message.type === 'WATCH_ASSET_REQUEST') {
    handleWatchAssetRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle wallet_addEthereumChain requests
  if (message.type === 'ADD_CHAIN_REQUEST') {
    handleAddChainRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle wallet_switchEthereumChain requests
  if (message.type === 'SWITCH_CHAIN_REQUEST') {
    handleSwitchChainRequest(message, sender, sendResponse);
    return true; // Keep the message channel open for the async response
  }
  
  // Handle transaction execution from the popup
  if (message.type === 'EXECUTE_TRANSACTION') {
    // This is called from the popup after user approves a transaction
    chrome.storage.local.get(['pendingTransaction'], async (result) => {
      if (!result.pendingTransaction) {
        sendResponse({ success: false, error: 'No pending transaction found' });
        return;
      }
      
      const pendingTx = result.pendingTransaction;
      
      try {
        // Get the account for the transaction
        const accountResult = await new Promise(resolve => {
          chrome.storage.local.get(['account'], resolve);
        });
        
        if (!accountResult.account) {
          sendResponse({ success: false, error: 'No account found' });
          return;
        }
        
        const account = JSON.parse(accountResult.account);
        const privateKey = account.privateKey;
        
        // Get transaction details from the pending transaction
        const { transaction, chainId } = pendingTx;
        
        // Perform the transaction - Import function from your existing utils
        // This is just a placeholder - you'll need to implement or import the actual transaction function
        const txResult = await executeTransaction(transaction, privateKey, chainId);
        const txHash = txResult.transaction?.hash;
        
        if (!txHash) {
          throw new Error('Failed to get transaction hash');
        }
        
        // Notify the content script about the transaction result
        chrome.runtime.sendMessage({
          type: 'SEND_TRANSACTION_RESPONSE', 
          approved: true,
          result: txHash, 
          requestId: pendingTx.id,
          txHash
        });
        
        sendResponse({ success: true, txHash });
      } catch (error) {
        console.error('Error processing transaction:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Transaction failed' 
        });
      }
    });
    
    return true; // Keep the message channel open for async response
  }
  
  // Handle signing from the popup
  if (message.type === 'EXECUTE_SIGNING') {
    // This is called from the popup after user approves a signing request
    // Implement similar to EXECUTE_TRANSACTION but for message signing
    return true; // Keep the message channel open for async response
  }
});

/**
 * Handle connection requests from websites
 */
function handleConnectRequest(message, sender, sendResponse) {
  const { origin, requestId } = message;
  
  if (!origin) {
    sendResponse({ error: 'Origin is required' });
    return;
  }

  console.log(`Processing connection request from ${origin} with requestId ${requestId}`);
  
  // First check if we have an account
  chrome.storage.local.get(['account'], (result) => {
    if (result.account) {
      try {
        const account = JSON.parse(result.account);
        
        // If no accounts or address not available, reject connection
        if (!account || !account.address) {
          console.log('No valid account available, cannot connect');
          sendResponse({ error: 'No accounts available' });
          return;
        }
        
        // Check if site is already connected
        if (state.connectedSites[origin] && state.connectedSites[origin].connected) {
          console.log(`Site ${origin} is already connected, returning accounts`);
          
          // Update the accounts array for consistency
          if (!state.accounts.includes(account.address)) {
            state.accounts = [account.address];
            // Save the updated state
            saveState();
          }
          
          sendResponse({ 
            success: true, 
            accounts: [account.address],
            chainId: state.selectedChainId || '137' // Default to Polygon if not set
          });
          return;
        }
        
        // Continue with connection request
        proceedWithConnectionRequest(origin, requestId, sendResponse);
      } catch (e) {
        console.error('Error parsing account data:', e);
        console.log('No accounts available in the wallet');
        sendResponse({ error: 'No accounts available' });
      }
    } else {
      console.log('No accounts available in the wallet');
      sendResponse({ error: 'No accounts available' });
    }
  });
  return true; // Keep the message channel open for the async response
}

/**
 * Process the connection request after we've confirmed we have accounts
 */
function proceedWithConnectionRequest(origin, requestId, sendResponse) {
  // Store the connection request in temporary storage
  const pendingRequest = {
    id: requestId,
    type: 'connect',
    origin,
    timestamp: Date.now()
  };
  
  console.log(`Creating pending connect request ${requestId} for ${origin}`);
  
  chrome.storage.local.set({ pendingConnectRequest: pendingRequest }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error storing connection request:', chrome.runtime.lastError);
      sendResponse({ error: 'Internal wallet error' });
      return;
    }
    
    // Open the popup for user approval
    openPopupForApproval('connect', requestId);
    
    // Respond that we're waiting for user approval
    sendResponse({ waiting: true });
  });
}

/**
 * Handle the response from the user for a connection request
 */
function handleConnectResponse(message) {
  const { requestId, approved, accounts } = message;
  
  console.log(`Processing connect response: requestId=${requestId}, approved=${approved}, accounts=${JSON.stringify(accounts)}`);
  
  // Retrieve the pending request from storage
  chrome.storage.local.get(['pendingConnectRequest', 'account'], (result) => {
    const pendingRequest = result.pendingConnectRequest;
    
    if (!pendingRequest) {
      console.error('No pending connect request found');
      return;
    }
    
    if (pendingRequest.id !== requestId) {
      console.error(`Request ID mismatch: expected ${pendingRequest.id}, got ${requestId}`);
      return;
    }
    
    const { origin } = pendingRequest;
    
    if (approved) {
      // User approved the connection
      // Use the accounts provided directly from the message or fall back to state accounts
      let accountsToUse = accounts && accounts.length > 0 ? accounts : state.accounts;
      
      // If still no accounts, try to get from storage as last resort
      if ((!accountsToUse || accountsToUse.length === 0) && result.account) {
        try {
          const accountObj = JSON.parse(result.account);
          if (accountObj && accountObj.address) {
            accountsToUse = [accountObj.address];
          }
        } catch (e) {
          console.error('Error parsing account data:', e);
        }
      }
      
      // Ensure the state.accounts is updated
      if (accountsToUse && accountsToUse.length > 0) {
        state.accounts = accountsToUse;
        saveState();
      }
      
      // Get the current chainId or use a default
      const chainId = state.selectedChainId || '137'; // Default to Polygon if not set
      
      console.log(`Connection approved for ${origin}. Using accounts:`, accountsToUse);
      
      // Update connected sites
      state.connectedSites[origin] = {
        origin,
        accounts: accountsToUse,
        chainId: chainId,
        connected: true,
        lastConnected: Date.now(),
        permissions: ['eth_accounts'], // Add basic permissions
        timestamp: Date.now() // Add timestamp for UI display
      };
      
      // Save the updated connected sites
      saveConnectedSites();
      
      // Create the EIP-1193 connect event data
      const connectEventData = {
        chainId
      };
      
      // Notify tabs with this origin
      chrome.tabs.query({}, (tabs) => {
        let messageDelivered = false;
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            // Send the connect response
            chrome.tabs.sendMessage(tab.id, {
              type: 'CONNECT_RESPONSE',
              requestId,
              approved: true,
              accounts: accountsToUse,
              chainId: chainId
            }, (response) => {
              // Check if we got a response from this tab
              if (chrome.runtime.lastError) {
                console.warn(`Error sending to tab ${tab.id}:`, chrome.runtime.lastError.message);
              } else if (response) {
                messageDelivered = true;
                console.log(`Connection response delivered to tab ${tab.id}`);
                
                // Also emit the connect event as per EIP-1193
                chrome.tabs.sendMessage(tab.id, {
                  type: 'WALLET_EVENT',
                  eventName: 'connect',
                  eventData: connectEventData
                });
                
                // Then emit the accountsChanged event
                chrome.tabs.sendMessage(tab.id, {
                  type: 'WALLET_EVENT',
                  eventName: 'accountsChanged',
                  eventData: accountsToUse
                });
              }
            });
          }
        });
        
        // Log if we couldn't find any matching tabs
        setTimeout(() => {
          if (!messageDelivered) {
            console.warn(`Could not find any tabs matching origin ${origin} to deliver connection response`);
          }
        }, 500);
      });
    } else {
      // User rejected the connection
      console.log(`Connection rejected for ${origin}`);
      
      // Notify tabs with this origin about rejection
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'CONNECT_RESPONSE',
              requestId,
              approved: false,
              error: { code: 4001, message: "User rejected the request." }
            });
          }
        });
      });
    }
    
    // Clear the pending request
    chrome.storage.local.remove(['pendingConnectRequest']);
  });
}

/**
 * Handle a switch chain request from a dApp
 */
function handleSwitchChainRequest(message, sender, sendResponse) {
  const { data } = message;
  const { chainId, origin, requestId } = data;
  
  console.log(`Processing chain switch request from ${origin} to chainId ${chainId}`);
  
  // Check if we're connected to this site
  if (!state.connectedSites[origin] || !state.connectedSites[origin].connected) {
    console.log(`Site ${origin} is not connected, cannot switch chain`);
    sendResponse({ error: 'Site not connected' });
    return;
  }
  
  // Check if the requested chain is already selected
  if (state.selectedChainId === chainId) {
    console.log(`Already on chain ${chainId}, no need to switch`);
    sendResponse({ chainId: chainId });
    return;
  }
  
  // Create a pending chain switch request
  const pendingRequest = {
    id: requestId,
    type: 'switchChain',
    origin,
    chainId,
    timestamp: Date.now()
  };
  
  // Store the pending request
  browserAPI.storage.local.set({ pendingChainRequest: pendingRequest }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Error storing chain switch request:', browserAPI.runtime.lastError);
      sendResponse({ error: 'Internal wallet error' });
      return;
    }
    
    // Open popup for approval
    openPopupForApproval('switchChain', requestId);
    
    // Respond that we're waiting for approval
    sendResponse({ waiting: true });
  });
  
  return true; // Keep the message channel open for async response
}

/**
 * Handle the response from the user for a chain switch request
 */
function handleSwitchChainResponse(message) {
  const { requestId, approved } = message;
  
  console.log(`Processing chain switch response: requestId=${requestId}, approved=${approved}`);
  
  // Retrieve the pending request from storage
  browserAPI.storage.local.get(['pendingChainRequest'], (result) => {
    const pendingRequest = result.pendingChainRequest;
    
    if (!pendingRequest) {
      console.error('No pending chain switch request found');
      return;
    }
    
    if (pendingRequest.id !== requestId) {
      console.error(`Request ID mismatch: expected ${pendingRequest.id}, got ${requestId}`);
      return;
    }
    
    const { origin, chainId } = pendingRequest;
    
    if (approved) {
      // User approved the chain switch
      console.log(`Chain switch approved for ${origin} to chainId ${chainId}`);
      
      // Update state with new chainId
      state.selectedChainId = chainId;
      saveState();
      
      // Update connected site
      if (state.connectedSites[origin]) {
        state.connectedSites[origin].chainId = chainId;
        saveConnectedSites();
      }
      
      // Notify tabs with this origin
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            // Send the switch chain response
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'SWITCH_CHAIN_RESPONSE',
              requestId,
              approved: true,
              chainId: chainId
            });
            
            // Also emit the chainChanged event as per EIP-1193
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'WALLET_EVENT',
              eventName: 'chainChanged',
              eventData: chainId
            });
          }
        });
      });
    } else {
      // User rejected the chain switch
      console.log(`Chain switch rejected for ${origin}`);
      
      // Notify tabs with this origin about rejection
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'SWITCH_CHAIN_RESPONSE',
              requestId,
              approved: false,
              error: { code: 4001, message: "User rejected the request." }
            });
          }
        });
      });
    }
    
    // Clear the pending request
    browserAPI.storage.local.remove(['pendingChainRequest']);
  });
}

/**
 * Handle a request to add a new Ethereum chain
 */
function handleAddChainRequest(message, sender, sendResponse) {
  const { data } = message;
  const { chainData, origin, requestId } = data;
  
  console.log(`Processing add chain request from ${origin}:`, chainData);
  
  // Check if we're connected to this site
  if (!state.connectedSites[origin] || !state.connectedSites[origin].connected) {
    console.log(`Site ${origin} is not connected, cannot add chain`);
    sendResponse({ error: { code: 4100, message: 'Site not connected' } });
    return;
  }
  
  // Validate chain data at a minimum
  if (!chainData || !chainData.chainId || !chainData.chainName || !chainData.rpcUrls || !chainData.rpcUrls.length) {
    console.log('Invalid chain data provided');
    sendResponse({ error: { code: 4200, message: 'Invalid chain parameters' } });
    return;
  }
  
  // Create a pending add chain request
  const pendingRequest = {
    id: requestId,
    type: 'addChain',
    origin,
    chainData,
    timestamp: Date.now()
  };
  
  // Store the pending request
  browserAPI.storage.local.set({ pendingAddChainRequest: pendingRequest }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Error storing add chain request:', browserAPI.runtime.lastError);
      sendResponse({ error: { code: 5000, message: 'Internal wallet error' } });
      return;
    }
    
    // Open popup for approval
    openPopupForApproval('addChain', requestId);
    
    // Respond that we're waiting for approval
    sendResponse({ waiting: true });
  });
  
  return true; // Keep the message channel open for async response
}

/**
 * Handle the response from the user for an add chain request
 */
function handleAddChainResponse(message) {
  const { requestId, approved } = message;
  
  console.log(`Processing add chain response: requestId=${requestId}, approved=${approved}`);
  
  // Retrieve the pending request from storage
  browserAPI.storage.local.get(['pendingAddChainRequest'], (result) => {
    const pendingRequest = result.pendingAddChainRequest;
    
    if (!pendingRequest) {
      console.error('No pending add chain request found');
      return;
    }
    
    if (pendingRequest.id !== requestId) {
      console.error(`Request ID mismatch: expected ${pendingRequest.id}, got ${requestId}`);
      return;
    }
    
    const { origin, chainData } = pendingRequest;
    const chainId = chainData.chainId;
    
    if (approved) {
      // User approved adding the chain
      console.log(`Add chain approved for ${origin}: ${chainId}`);
      
      // Add to custom chains
      state.customChains[chainId] = {
        ...chainData,
        addedBy: origin,
        timestamp: Date.now()
      };
      saveCustomChains();
      
      // Optionally also switch to this chain if specified
      if (message.switchToChain) {
        state.selectedChainId = chainId;
        saveState();
        
        // Update connected site
        if (state.connectedSites[origin]) {
          state.connectedSites[origin].chainId = chainId;
          saveConnectedSites();
        }
        
        // Notify about chain change
        browserAPI.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            if (tab.url && tab.url.includes(origin)) {
              browserAPI.tabs.sendMessage(tab.id, {
                type: 'WALLET_EVENT',
                eventName: 'chainChanged',
                eventData: chainId
              });
            }
          });
        });
      }
      
      // Notify tabs with this origin
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'ADD_CHAIN_RESPONSE',
              requestId,
              approved: true
            });
          }
        });
      });
    } else {
      // User rejected adding the chain
      console.log(`Add chain rejected for ${origin}`);
      
      // Notify tabs with this origin about rejection
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'ADD_CHAIN_RESPONSE',
              requestId,
              approved: false,
              error: { code: 4001, message: "User rejected the request." }
            });
          }
        });
      });
    }
    
    // Clear the pending request
    browserAPI.storage.local.remove(['pendingAddChainRequest']);
  });
}

/**
 * Handle transaction signing requests
 */
function handleSendTransactionRequest(message, sender, sendResponse) {
  const { data } = message;
  const { transaction, origin, requestId } = data;
  
  console.log(`Processing transaction request from ${origin}:`, transaction);
  
  // Check if we're connected to this site
  if (!state.connectedSites[origin] || !state.connectedSites[origin].connected) {
    console.log(`Site ${origin} is not connected, cannot send transaction`);
    sendResponse({ error: { code: 4100, message: 'Site not connected' } });
    return;
  }
  
  // Validate the transaction
  if (!transaction || typeof transaction !== 'object') {
    console.log('Invalid transaction data');
    sendResponse({ error: { code: 4200, message: 'Invalid transaction parameters' } });
    return;
  }
  
  // Create a pending transaction request
  const pendingRequest = {
    id: requestId,
    type: 'transaction',
    origin,
    transaction,
    chainId: state.selectedChainId,
    timestamp: Date.now()
  };
  
  // Validate the transaction data more thoroughly
  if (!transaction.to && !transaction.data) {
    console.error('Transaction must have a "to" address or contract data');
    sendResponse({ error: { code: 4200, message: 'Invalid transaction parameters: missing "to" or "data"' } });
    return;
  }

  // Check if user has enough balance (basic check)
  if (transaction.value) {
    // Get balance check functionality would go here
    console.log('Transaction value:', transaction.value);
  }
  
  // Store the pending request
  browserAPI.storage.local.set({ pendingTransactionRequest: pendingRequest }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Error storing transaction request:', browserAPI.runtime.lastError);
      sendResponse({ error: { code: 5000, message: 'Internal wallet error' } });
      return;
    }
    
    // Open popup for approval
    openPopupForApproval('transaction', requestId);
    
    // Respond that we're waiting for approval
    sendResponse({ waiting: true });
  });
  
  return true; // Keep the message channel open for async response
}

/**
 * Handle the response from the user for a transaction request
 */
function handleTransactionResponse(message) {
  const { requestId, approved, txHash } = message;
  
  console.log(`Processing transaction response: requestId=${requestId}, approved=${approved}, txHash=${txHash}`);
  
  // Retrieve the pending request from storage
  browserAPI.storage.local.get(['pendingTransactionRequest'], (result) => {
    const pendingRequest = result.pendingTransactionRequest;
    
    if (!pendingRequest) {
      console.error('No pending transaction request found');
      return;
    }
    
    if (pendingRequest.id !== requestId) {
      console.error(`Request ID mismatch: expected ${pendingRequest.id}, got ${requestId}`);
      return;
    }
    
    const { origin } = pendingRequest;
    
    if (approved) {
      // User approved the transaction
      console.log(`Transaction approved for ${origin}, hash: ${txHash}`);
      
      // Notify tabs with this origin
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'SEND_TRANSACTION_RESPONSE',
              requestId,
              approved: true,
              result: txHash
            });
          }
        });
      });
    } else {
      // User rejected the transaction
      console.log(`Transaction rejected for ${origin}`);
      
      // Notify tabs with this origin about rejection
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: 'SEND_TRANSACTION_RESPONSE',
              requestId,
              approved: false,
              error: { code: 4001, message: "User rejected the request." }
            });
          }
        });
      });
    }
    
    // Clear the pending request
    browserAPI.storage.local.remove(['pendingTransactionRequest']);
  });
}

/**
 * Handle personal sign requests (for signing messages)
 */
function handlePersonalSignRequest(message, sender, sendResponse) {
  const { data } = message;
  const { msgData, address, origin, requestId } = data;
  
  console.log(`Processing personal sign request from ${origin}`);
  
  // Check if we're connected to this site
  if (!state.connectedSites[origin] || !state.connectedSites[origin].connected) {
    console.log(`Site ${origin} is not connected, cannot sign message`);
    sendResponse({ error: { code: 4100, message: 'Site not connected' } });
    return;
  }
  
  // Check if the address is authorized for this site
  if (!state.connectedSites[origin].accounts.includes(address)) {
    console.log(`Address ${address} not authorized for ${origin}`);
    sendResponse({ error: { code: 4100, message: 'Unauthorized account' } });
    return;
  }
  
  // Create a pending sign request
  const pendingRequest = {
    id: requestId,
    type: 'personalSign',
    origin,
    msgData,
    address,
    timestamp: Date.now()
  };
  
  // Store the pending request
  browserAPI.storage.local.set({ pendingSignRequest: pendingRequest }, () => {
    if (browserAPI.runtime.lastError) {
      console.error('Error storing sign request:', browserAPI.runtime.lastError);
      sendResponse({ error: { code: 5000, message: 'Internal wallet error' } });
      return;
    }
    
    // Open popup for approval
    openPopupForApproval('personalSign', requestId);
    
    // Respond that we're waiting for approval
    sendResponse({ waiting: true });
  });
  
  return true; // Keep the message channel open for async response
}

/**
 * Handle the response from the user for a sign request
 */
function handleSignResponse(message) {
  const { requestId, approved, signature } = message;
  
  console.log(`Processing sign response: requestId=${requestId}, approved=${approved}, signature=${signature}`);
  
  // Retrieve the pending request from storage
  browserAPI.storage.local.get(['pendingSignRequest'], (result) => {
    const pendingRequest = result.pendingSignRequest;
    
    if (!pendingRequest) {
      console.error('No pending sign request found');
      return;
    }
    
    if (pendingRequest.id !== requestId) {
      console.error(`Request ID mismatch: expected ${pendingRequest.id}, got ${requestId}`);
      return;
    }
    
    const { origin, type } = pendingRequest;
    
    if (approved) {
      // User approved the signing
      console.log(`Signing approved for ${origin}, signature: ${signature}`);
      
      // Determine the response type based on the request type
      const responseType = 
        type === 'personalSign' ? 'PERSONAL_SIGN_RESPONSE' :
        type === 'ethSign' ? 'ETH_SIGN_RESPONSE' : 
        'TYPED_SIGN_RESPONSE';
      
      // Notify tabs with this origin
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: responseType,
              requestId,
              approved: true,
              result: signature
            });
          }
        });
      });
    } else {
      // User rejected the signing
      console.log(`Signing rejected for ${origin}`);
      
      // Determine the response type based on the request type
      const responseType = 
        type === 'personalSign' ? 'PERSONAL_SIGN_RESPONSE' :
        type === 'ethSign' ? 'ETH_SIGN_RESPONSE' : 
        'TYPED_SIGN_RESPONSE';
      
      // Notify tabs with this origin about rejection
      browserAPI.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && tab.url.includes(origin)) {
            browserAPI.tabs.sendMessage(tab.id, {
              type: responseType,
              requestId,
              approved: false,
              error: { code: 4001, message: "User rejected the request." }
            });
          }
        });
      });
    }
    
    // Clear the pending request
    browserAPI.storage.local.remove(['pendingSignRequest']);
  });
}

// Add event listeners for popup response types to existing runtime.onMessage
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'APPROVE_SWITCH_CHAIN') {
    handleSwitchChainResponse(message);
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'APPROVE_ADD_CHAIN') {
    handleAddChainResponse(message);
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'APPROVE_SIGN') {
    handleSignResponse(message);
    sendResponse({ success: true });
    return;
  }
});

/**
 * Handle standard EIP-1193 requests from web3 providers
 */
function handleWeb3Request(message, sender, sendResponse) {
  const { method, params, origin, requestId } = message;
  
  console.log(`Processing web3 request from ${origin}: ${method}`);
  
  // Different method handlers
  switch(method) {
    case 'eth_requestAccounts':
      handleConnectRequest({ origin, requestId }, sender, sendResponse);
      return true;  // Keep channel open for async response
      
    case 'eth_accounts':
      if (state.connectedSites[origin] && state.connectedSites[origin].connected) {
        sendResponse({ result: state.connectedSites[origin].accounts });
      } else {
        sendResponse({ result: [] });
      }
      return;
      
    case 'eth_chainId':
      sendResponse({ result: state.selectedChainId || '137' });
      return;
      
    case 'eth_sendTransaction':
      handleSendTransactionRequest({ 
        data: { 
          transaction: params[0], 
          origin, 
          requestId 
        } 
      }, sender, sendResponse);
      return true;  // Keep channel open for async response
      
    case 'personal_sign':
      handlePersonalSignRequest({
        data: {
          msgData: params[0],
          address: params[1],
          origin,
          requestId
        }
      }, sender, sendResponse);
      return true;  // Keep channel open for async response
      
    case 'wallet_switchEthereumChain':
      handleSwitchChainRequest({
        data: {
          chainId: params[0].chainId,
          origin,
          requestId
        }
      }, sender, sendResponse);
      return true;  // Keep channel open for async response
      
    case 'wallet_addEthereumChain':
      handleAddChainRequest({
        data: {
          chainData: params[0],
          origin,
          requestId
        }
      }, sender, sendResponse);
      return true;  // Keep channel open for async response
      
    // Add more method handlers as needed
    
    default:
      console.warn(`Unsupported method: ${method}`);
      sendResponse({ error: { code: 4200, message: `Method ${method} not supported` } });
      return;
  }
}