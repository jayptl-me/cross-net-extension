/**
 * JSON-RPC Batch Request Utility
 * 
 * This utility provides methods for optimizing RPC requests:
 * 1. Batching multiple requests into a single call
 * 2. Utilizing the cache to avoid redundant network calls
 * 3. Handling security and compliance monitoring
 */

// Browser compatibility layer
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
        },
        set: function(items) {
          return new Promise((resolve) => {
            if (isFirefox) {
              browser.storage.local.set(items).then(resolve);
            } else {
              chrome.storage.local.set(items, resolve);
            }
          });
        }
      }
    }
  };
})();

/**
 * Simple in-memory cache for RPC requests
 */
const rpcCache = {
  cache: new Map(),
  
  get: function(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    
    // Check if item is expired
    if (item.expiry && item.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    
    return item.value;
  },
  
  set: function(key, value, ttl = 30000) { // Default TTL: 30 seconds
    const expiry = ttl ? Date.now() + ttl : null;
    this.cache.set(key, { value, expiry });
  },
  
  has: function(key) {
    return this.get(key) !== undefined;
  },
  
  delete: function(key) {
    return this.cache.delete(key);
  },
  
  clear: function() {
    this.cache.clear();
  }
};

/**
 * Execute a batch of RPC requests
 * @param {Array} requests - Array of RPC request objects
 * @param {string} chainId - Target chain ID
 * @returns {Promise<Array>} - Array of responses in the same order as requests
 */
async function batchRpcRequests(requests, chainId) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('Batch requests must be a non-empty array');
  }

  // Prepare batch of requests
  const batchPayload = requests.map((req, index) => ({
    jsonrpc: '2.0',
    id: req.id || index + 1,
    method: req.method,
    params: req.params || []
  }));

  console.log(`Executing batch of ${requests.length} requests`);
  
  try {
    // Get the RPC endpoint for the chain
    const rpcUrl = await getRpcEndpoint(chainId);
    
    // Check cache first for cacheable requests
    const cachedResults = [];
    const uncachedRequests = [];
    const uncachedIndices = [];
    
    batchPayload.forEach((request, index) => {
      const cacheKey = `${request.method}:${JSON.stringify(request.params)}:${chainId}`;
      const cachedResult = rpcCache.get(cacheKey);
      
      if (cachedResult !== undefined) {
        cachedResults[index] = { ...cachedResult, id: request.id };
      } else {
        uncachedRequests.push(request);
        uncachedIndices.push(index);
      }
    });
    
    // If all results are cached, return them
    if (uncachedRequests.length === 0) {
      return cachedResults;
    }
    
    // Execute the request for uncached items
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(uncachedRequests.length === 1 ? uncachedRequests[0] : uncachedRequests),
      credentials: 'omit'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const results = await response.json();
    
    // Process results and update cache
    if (Array.isArray(results)) {
      results.forEach((result, idx) => {
        const originalIndex = uncachedIndices[idx];
        cachedResults[originalIndex] = result;
        
        // Cache successful results
        if (!result.error) {
          const request = batchPayload[originalIndex];
          const cacheKey = `${request.method}:${JSON.stringify(request.params)}:${chainId}`;
          
          // Determine TTL based on method type
          let ttl = 30000; // Default 30 seconds
          if (request.method === 'eth_blockNumber') ttl = 10000; // 10 seconds
          else if (request.method === 'eth_getBlockByNumber') ttl = 60000; // 1 minute
          else if (request.method === 'eth_chainId') ttl = 3600000; // 1 hour
          
          rpcCache.set(cacheKey, { ...result, id: null }, ttl);
        }
      });
    } else if (uncachedRequests.length === 1) {
      // Single request sent (not as array)
      const originalIndex = uncachedIndices[0];
      cachedResults[originalIndex] = results;
      
      // Cache successful results
      if (!results.error) {
        const request = batchPayload[originalIndex];
        const cacheKey = `${request.method}:${JSON.stringify(request.params)}:${chainId}`;
        rpcCache.set(cacheKey, { ...results, id: null });
      }
    }
    
    // Fill any remaining empty slots with error objects
    return cachedResults.map((result, index) => {
      if (result) return result;
      return { 
        id: batchPayload[index].id, 
        error: { code: -32603, message: 'Internal error: No response for request' },
        jsonrpc: '2.0'
      };
    });
  } catch (error) {
    console.error('Batch request failed:', error);
    
    // Attempt error recovery for network issues
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      console.warn('Network error detected, attempting to use fallback RPC endpoint');
      try {
        const fallbackEndpoint = await getFallbackRpcEndpoint(chainId);
        if (fallbackEndpoint) {
          console.log(`Retrying batch request with fallback endpoint: ${fallbackEndpoint}`);
          
          const response = await fetch(fallbackEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batchPayload),
            credentials: 'omit'
          });
          
          if (response.ok) {
            const results = await response.json();
            return Array.isArray(results) ? results : [results];
          }
        }
      } catch (fallbackError) {
        console.error('Fallback request also failed:', fallbackError);
      }
    }
    
    // If all recovery attempts fail, throw the original error
    throw error;
  }
}

/**
 * Get the appropriate RPC endpoint for a chain ID
 * @param {string} chainId - The target chain ID
 * @returns {Promise<string>} - RPC endpoint URL
 */
async function getRpcEndpoint(chainId) {
  try {
    const result = await browserAPI.storage.local.get(['customChains']);
    const customChains = result.customChains || {};
    
    // First check if we have a custom chain configuration
    if (customChains[chainId] && customChains[chainId].rpcUrls && customChains[chainId].rpcUrls.length > 0) {
      return customChains[chainId].rpcUrls[0];
    }
    
    // Otherwise use default RPC endpoints
    // Map of chain IDs to their default RPC endpoints
    const defaultRpcEndpoints = {
      '1': 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Ethereum
      '137': 'https://polygon-rpc.com', // Polygon
      '56': 'https://bsc-dataseed.binance.org', // Binance Smart Chain
      '43114': 'https://api.avax.network/ext/bc/C/rpc', // Avalanche
      '42161': 'https://arb1.arbitrum.io/rpc', // Arbitrum
      '10': 'https://mainnet.optimism.io', // Optimism
      '250': 'https://rpc.ftm.tools', // Fantom
      '5': 'https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Goerli Testnet
      '80001': 'https://rpc-mumbai.maticvigil.com', // Mumbai Testnet
      '97': 'https://data-seed-prebsc-1-s1.binance.org:8545', // BSC Testnet
      '11155111': 'https://rpc.sepolia.org', // Sepolia Testnet
      '80002': 'https://rpc-amoy.polygon.technology', // Polygon Amoy Testnet
    };
    
    // Return the default RPC endpoint for the chain ID, or a fallback endpoint
    const endpoint = defaultRpcEndpoints[chainId] || defaultRpcEndpoints['1'];
    return endpoint;
  } catch (error) {
    console.error('Error getting RPC endpoint:', error);
    // Default fallback for critical errors
    return 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161';
  }
}

/**
 * Get a fallback RPC endpoint when the primary one fails
 * @param {string} chainId - The target chain ID
 * @returns {Promise<string|null>} - Fallback RPC endpoint URL or null if none available
 */
async function getFallbackRpcEndpoint(chainId) {
  try {
    const result = await browserAPI.storage.local.get(['customChains']);
    const customChains = result.customChains || {};
    
    // Check for fallback in custom chains
    if (customChains[chainId] && customChains[chainId].rpcUrls && customChains[chainId].rpcUrls.length > 1) {
      return customChains[chainId].rpcUrls[1]; // Return secondary URL
    }
    
    // Fallback RPC endpoints for major networks
    const fallbackRpcEndpoints = {
      '1': 'https://eth.llamarpc.com', // Ethereum
      '137': 'https://polygon.llamarpc.com', // Polygon
      '56': 'https://bsc-dataseed2.binance.org', // Binance Smart Chain
      '43114': 'https://avalanche-c-chain.publicnode.com', // Avalanche
      '42161': 'https://arbitrum.llamarpc.com', // Arbitrum
      '10': 'https://optimism.llamarpc.com', // Optimism
      '250': 'https://fantom.publicnode.com', // Fantom
      '5': 'https://ethereum-goerli.publicnode.com', // Goerli Testnet
      '80001': 'https://polygon-mumbai.blockpi.network/v1/rpc/public', // Mumbai Testnet
      '11155111': 'https://ethereum-sepolia.blockpi.network/v1/rpc/public', // Sepolia Testnet
      '80002': 'https://polygon-amoy.blockpi.network/v1/rpc/public', // Polygon Amoy Testnet
    };
    
    return fallbackRpcEndpoints[chainId] || null;
  } catch (error) {
    console.error('Error getting fallback RPC endpoint:', error);
    return null;
  }
}

/**
 * Compliance monitoring hook for transactions
 * 
 * This is a simple implementation of regulatory hooks that could be extended
 * with more sophisticated checks like TRISA compliance, sanctions screening, etc.
 * 
 * @param {Object} transaction - The transaction object
 * @param {string} from - The sending address
 * @param {string} chainId - The chain ID
 * @returns {Object} - { allowed: boolean, reason: string|null }
 */
async function complianceCheck(transaction, from, chainId) {
  // Basic transaction validation
  if (!transaction || !from) {
    return { allowed: false, reason: 'Invalid transaction or sender' };
  }
  
  const result = {
    allowed: true,
    reason: null,
    risks: [],
    transactionScreening: {
      timestamp: Date.now(),
      version: '1.0.0',
      result: 'PASS'
    }
  };
  
  try {
    // Check for high-risk patterns
    if (transaction.value && parseFloat(transaction.value) > 1000000000000000000000) { // > 1000 ETH
      result.risks.push('Large transfer detected');
    }
    
    // Check against sanctions list - simplified example
    // In a real implementation, this would call an external API or use a local database
    const mockSanctionsList = [
      '0x1234567890123456789012345678901234567890', // Example sanctioned address
    ];
    
    // Check if recipient is on sanctions list
    if (transaction.to && mockSanctionsList.includes(transaction.to.toLowerCase())) {
      result.allowed = false;
      result.reason = 'Recipient address is on sanctions list';
      result.transactionScreening.result = 'BLOCKED';
      return result;
    }
    
    // Check sender
    if (from && mockSanctionsList.includes(from.toLowerCase())) {
      result.allowed = false;
      result.reason = 'Sender address is on sanctions list';
      result.transactionScreening.result = 'BLOCKED';
      return result;
    }
    
    // Log suspicious activity for regulatory review
    if (result.risks.length > 0) {
      console.warn('Suspicious transaction detected:', {
        transaction,
        risks: result.risks,
        chainId
      });
      
      // In a production system, you might want to:
      // 1. Log this to a secure database
      // 2. Notify compliance team
      // 3. Implement additional verification steps
      
      // For now, we still allow the transaction but mark it as suspicious
      result.transactionScreening.result = 'SUSPICIOUS';
    }
    
    return result;
  } catch (error) {
    console.error('Error in compliance check:', error);
    // Default to allowing the transaction if there's an error in our screening logic
    // A production system might want to be more conservative here
    return { allowed: true, reason: 'Compliance check error, proceeding with caution' };
  }
}

/**
 * Check if an address belongs to a known exchange or contract
 * Useful for travel rule compliance
 * 
 * @param {string} address - Ethereum address to check
 * @param {string} chainId - Chain ID
 * @returns {Promise<Object>} - { isExchange: boolean, name: string|null, category: string|null }
 */
async function identifyAddress(address, chainId) {
  // Mock database of known addresses
  // In a real implementation, this would call an API or use a comprehensive database
  const knownAddresses = {
    // Exchanges
    '0x28c6c06298d514db089934071355e5743bf21d60': { isExchange: true, name: 'Binance', category: 'exchange' },
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { isExchange: true, name: 'Coinbase', category: 'exchange' },
    '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2': { isExchange: true, name: 'FTX', category: 'exchange' },
    
    // DEXes
    '0x1f98431c8ad98523631ae4a59f267346ea31f984': { isExchange: true, name: 'Uniswap V3', category: 'dex' },
    
    // Known contracts
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { isExchange: false, name: 'Uniswap V2 Router', category: 'contract' },
  };

  // Normalize address
  const normalizedAddress = address.toLowerCase();
  
  // Check local database first
  if (knownAddresses[normalizedAddress]) {
    return knownAddresses[normalizedAddress];
  }
  
  // If not found in local database, could query a blockchain analytics API
  // For now, just return a default response
  return { isExchange: false, name: null, category: null };
}

// Export the functions
export { 
  batchRpcRequests, 
  getRpcEndpoint, 
  complianceCheck,
  identifyAddress
};