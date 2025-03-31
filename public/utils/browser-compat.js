/**
 * Browser Extension Compatibility Layer
 * 
 * This utility provides a cross-browser compatible API for extension features.
 * It handles differences between Chrome and Firefox extension APIs and provides
 * error recovery for common extension issues like context invalidation.
 */

/**
 * Browser detection and API normalization
 */
const browserPolyfill = (function() {
  // Detect browser type
  const isFirefox = typeof browser !== 'undefined';
  const isChrome = typeof chrome !== 'undefined';
  
  // Create unified API
  const api = {};
  
  // Storage API
  api.storage = {
    local: {
      get: function(keys, callback) {
        if (isFirefox) {
          // Firefox uses promise-based API
          const promise = browser.storage.local.get(keys);
          if (callback) {
            promise.then(callback).catch(error => {
              console.error('Storage API error:', error);
              callback({}); // Provide empty result on error
            });
          }
          return promise;
        } else if (isChrome) {
          // Chrome uses callback-based API
          return new Promise((resolve) => {
            try {
              chrome.storage.local.get(keys, (result) => {
                const error = chrome.runtime.lastError;
                if (error) {
                  console.error('Chrome storage error:', error);
                  if (callback) callback({});
                  resolve({});
                } else {
                  if (callback) callback(result);
                  resolve(result);
                }
              });
            } catch (e) {
              console.error('Exception in storage.get:', e);
              if (callback) callback({});
              resolve({});
            }
          });
        }
        // Fallback for other browsers or testing environments
        return Promise.resolve({});
      },
      
      set: function(items, callback) {
        if (isFirefox) {
          const promise = browser.storage.local.set(items);
          if (callback) {
            promise.then(callback).catch(error => {
              console.error('Storage API error:', error);
              callback();
            });
          }
          return promise;
        } else if (isChrome) {
          return new Promise((resolve) => {
            try {
              chrome.storage.local.set(items, () => {
                const error = chrome.runtime.lastError;
                if (error) {
                  console.error('Chrome storage error:', error);
                }
                if (callback) callback();
                resolve();
              });
            } catch (e) {
              console.error('Exception in storage.set:', e);
              if (callback) callback();
              resolve();
            }
          });
        }
        // Fallback
        return Promise.resolve();
      },
      
      remove: function(keys, callback) {
        if (isFirefox) {
          const promise = browser.storage.local.remove(keys);
          if (callback) {
            promise.then(callback).catch(error => {
              console.error('Storage API error:', error);
              callback();
            });
          }
          return promise;
        } else if (isChrome) {
          return new Promise((resolve) => {
            try {
              chrome.storage.local.remove(keys, () => {
                const error = chrome.runtime.lastError;
                if (error) {
                  console.error('Chrome storage error:', error);
                }
                if (callback) callback();
                resolve();
              });
            } catch (e) {
              console.error('Exception in storage.remove:', e);
              if (callback) callback();
              resolve();
            }
          });
        }
        // Fallback
        return Promise.resolve();
      }
    }
  };
  
  // Runtime API
  api.runtime = {
    sendMessage: function(message, callback) {
      if (isFirefox) {
        const promise = browser.runtime.sendMessage(message);
        if (callback) {
          promise.then(callback).catch(error => {
            console.error('Runtime API error:', error);
            // Return error response to callback
            callback({ error: error.message || 'Firefox extension error' });
          });
        }
        return promise;
      } else if (isChrome) {
        return new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(message, (response) => {
              const error = chrome.runtime.lastError;
              if (error) {
                console.error('Chrome runtime error:', error);
                if (callback) callback({ error: error.message || 'Chrome extension error' });
                resolve({ error: error.message || 'Chrome extension error' });
              } else {
                if (callback) callback(response);
                resolve(response);
              }
            });
          } catch (e) {
            console.error('Exception in runtime.sendMessage:', e);
            const errorResponse = { error: e.message || 'Exception in sendMessage' };
            if (callback) callback(errorResponse);
            resolve(errorResponse);
          }
        });
      }
      // Fallback
      return Promise.resolve({ error: 'Browser API not supported' });
    },
    
    onMessage: {
      addListener: function(listener) {
        const wrappedListener = function(message, sender, sendResponse) {
          try {
            return listener(message, sender, sendResponse);
          } catch (error) {
            console.error('Error in message listener:', error);
            sendResponse({ error: error.message || 'Error in message handler' });
            return false;
          }
        };
        
        if (isFirefox) {
          browser.runtime.onMessage.addListener(wrappedListener);
        } else if (isChrome) {
          chrome.runtime.onMessage.addListener(wrappedListener);
        }
        
        // Return a function to remove the listener
        return function removeListener() {
          if (isFirefox) {
            browser.runtime.onMessage.removeListener(wrappedListener);
          } else if (isChrome) {
            chrome.runtime.onMessage.removeListener(wrappedListener);
          }
        };
      }
    }
  };
  
  // Tabs API
  api.tabs = {
    query: function(queryInfo, callback) {
      if (isFirefox) {
        const promise = browser.tabs.query(queryInfo);
        if (callback) {
          promise.then(callback).catch(error => {
            console.error('Tabs API error:', error);
            callback([]);
          });
        }
        return promise;
      } else if (isChrome) {
        return new Promise((resolve) => {
          try {
            chrome.tabs.query(queryInfo, (tabs) => {
              const error = chrome.runtime.lastError;
              if (error) {
                console.error('Chrome tabs error:', error);
                if (callback) callback([]);
                resolve([]);
              } else {
                if (callback) callback(tabs);
                resolve(tabs);
              }
            });
          } catch (e) {
            console.error('Exception in tabs.query:', e);
            if (callback) callback([]);
            resolve([]);
          }
        });
      }
      // Fallback
      return Promise.resolve([]);
    },
    
    sendMessage: function(tabId, message, callback) {
      if (isFirefox) {
        const promise = browser.tabs.sendMessage(tabId, message);
        if (callback) {
          promise.then(callback).catch(error => {
            console.error(`Tabs API error for tab ${tabId}:`, error);
            callback({ error: error.message || 'Firefox extension error' });
          });
        }
        return promise;
      } else if (isChrome) {
        return new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
              const error = chrome.runtime.lastError;
              if (error) {
                // Don't log errors about frames not existing - these are common
                if (!error.message.includes('frames not exist')) {
                  console.error(`Chrome tabs error for tab ${tabId}:`, error);
                }
                if (callback) callback({ error: error.message });
                resolve({ error: error.message });
              } else {
                if (callback) callback(response);
                resolve(response);
              }
            });
          } catch (e) {
            console.error(`Exception in tabs.sendMessage for tab ${tabId}:`, e);
            const errorResponse = { error: e.message || 'Exception in sendMessage' };
            if (callback) callback(errorResponse);
            resolve(errorResponse);
          }
        });
      }
      // Fallback
      return Promise.resolve({ error: 'Browser API not supported' });
    },
    
    create: function(createProperties, callback) {
      if (isFirefox) {
        const promise = browser.tabs.create(createProperties);
        if (callback) {
          promise.then(callback).catch(error => {
            console.error('Tabs API error:', error);
            callback(null);
          });
        }
        return promise;
      } else if (isChrome) {
        return new Promise((resolve) => {
          try {
            chrome.tabs.create(createProperties, (tab) => {
              const error = chrome.runtime.lastError;
              if (error) {
                console.error('Chrome tabs error:', error);
                if (callback) callback(null);
                resolve(null);
              } else {
                if (callback) callback(tab);
                resolve(tab);
              }
            });
          } catch (e) {
            console.error('Exception in tabs.create:', e);
            if (callback) callback(null);
            resolve(null);
          }
        });
      }
      // Fallback
      return Promise.resolve(null);
    }
  };
  
  // Windows API
  api.windows = {
    create: function(createData, callback) {
      if (isFirefox) {
        const promise = browser.windows.create(createData);
        if (callback) {
          promise.then(callback).catch(error => {
            console.error('Windows API error:', error);
            callback(null);
          });
        }
        return promise;
      } else if (isChrome) {
        return new Promise((resolve) => {
          try {
            chrome.windows.create(createData, (window) => {
              const error = chrome.runtime.lastError;
              if (error) {
                console.error('Chrome windows error:', error);
                if (callback) callback(null);
                resolve(null);
              } else {
                if (callback) callback(window);
                resolve(window);
              }
            });
          } catch (e) {
            console.error('Exception in windows.create:', e);
            if (callback) callback(null);
            resolve(null);
          }
        });
      }
      // Fallback
      return Promise.resolve(null);
    }
  };
  
  // Return the unified API
  return api;
})();

/**
 * Error recovery for extension context invalidation
 * This is useful for handling the "Extension context invalidated" error
 * that can occur when the extension is updated or reloaded
 */
function withContextRecovery(fn) {
  return async function(...args) {
    try {
      return await fn(...args);
    } catch (error) {
      if (error.message && (
          error.message.includes('Extension context invalidated') || 
          error.message.includes('context invalidated') ||
          error.message.includes('Extension context was invalidated')
      )) {
        console.warn('Extension context was invalidated, attempting recovery...');
        
        // Attempt recovery by using a fallback approach or reloading
        try {
          // If in content script, we can try to reconnect via postMessage
          if (window.location !== window.parent.location) {
            // We're in an iframe
            console.log('In iframe, using postMessage for recovery');
            
            // Try to reestablish connection through postMessage
            window.parent.postMessage({
              type: 'CROSSNET_CONTEXT_RECOVERY',
              timestamp: Date.now()
            }, '*');
            
            return { recovered: true, error: 'Context invalidated, reconnection attempted' };
          } else {
            // In main window, suggest reload
            console.log('In main window, suggesting page reload');
            
            // Show a user-friendly message
            const userAlert = document.createElement('div');
            userAlert.style.cssText = `
              position: fixed;
              top: 20px;
              right: 20px;
              background: #f44336;
              color: white;
              padding: 16px;
              border-radius: 4px;
              box-shadow: 0 4px 8px rgba(0,0,0,0.2);
              z-index: 10000;
              font-family: sans-serif;
              max-width: 400px;
            `;
            userAlert.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <strong>Extension Issue</strong>
                <button style="background: none; border: none; color: white; cursor: pointer; font-size: 16px;"
                  onclick="this.parentNode.parentNode.remove()">×</button>
              </div>
              <p>The wallet extension needs to be refreshed. Please reload the page to continue.</p>
              <button style="background: white; color: #f44336; border: none; padding: 8px 16px; 
                border-radius: 4px; cursor: pointer; margin-top: 8px; font-weight: bold;"
                onclick="window.location.reload()">Reload Page</button>
            `;
            document.body.appendChild(userAlert);
            
            // Auto-remove after 15 seconds
            setTimeout(() => {
              if (document.body.contains(userAlert)) {
                userAlert.remove();
              }
            }, 15000);
            
            return { recovered: false, error: 'Extension context invalidated, page reload required' };
          }
        } catch (recoveryError) {
          console.error('Recovery attempt failed:', recoveryError);
          return { recovered: false, error: 'Extension context invalidated and recovery failed' };
        }
      } else {
        // This is some other error, rethrow it
        throw error;
      }
    }
  };
}

/**
 * Create a secure connection to the extension background script
 * that handles context invalidation and reconnection automatically
 */
class BackgroundConnection {
  constructor() {
    this._connected = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectDelay = 1000; // 1 second initial delay
    this._pendingRequests = new Map();
    this._nextRequestId = 1;
    
    // Set up message listener
    this._removeListener = browserPolyfill.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle response messages
      if (message.type === 'RESPONSE' && message.requestId && this._pendingRequests.has(message.requestId)) {
        const { resolve, reject, timeout } = this._pendingRequests.get(message.requestId);
        
        // Clear timeout
        if (timeout) {
          clearTimeout(timeout);
        }
        
        // Remove from pending requests
        this._pendingRequests.delete(message.requestId);
        
        // Resolve or reject the promise
        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.data);
        }
        
        // Indicate we handled the message
        sendResponse({ received: true });
        return true;
      }
      
      // Default response for unhandled messages
      return false;
    });
  }
  
  /**
   * Send a message to the background script and wait for a response
   * @param {Object} message - Message to send
   * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns {Promise<any>} - Response data or error
   */
  sendMessage = withContextRecovery(async function(message, timeoutMs = 30000) {
    // Add request ID and timestamp
    const requestId = this._nextRequestId++;
    const enrichedMessage = {
      ...message,
      requestId,
      timestamp: Date.now()
    };
    
    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        if (this._pendingRequests.has(requestId)) {
          this._pendingRequests.delete(requestId);
          reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      
      // Store the request
      this._pendingRequests.set(requestId, { resolve, reject, timeout, message: enrichedMessage });
      
      // Send the message
      browserPolyfill.runtime.sendMessage(enrichedMessage)
        .then(response => {
          if (response && response.error) {
            reject(new Error(response.error));
          }
        })
        .catch(error => {
          // Handle errors in sending
          if (this._pendingRequests.has(requestId)) {
            clearTimeout(timeout);
            this._pendingRequests.delete(requestId);
            reject(error);
          }
        });
    });
    
    return responsePromise;
  });
  
  /**
   * Close the connection and clean up resources
   */
  close() {
    // Remove message listener
    if (this._removeListener) {
      this._removeListener();
    }
    
    // Reject all pending requests
    for (const [requestId, { reject, timeout }] of this._pendingRequests.entries()) {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
      this._pendingRequests.delete(requestId);
    }
    
    this._connected = false;
  }
}

// Export the API
export {
  browserPolyfill,
  withContextRecovery,
  BackgroundConnection
};