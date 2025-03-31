/**
 * Browser Feature Detection Utility
 * 
 * This utility provides:
 * 1. Methods to detect browser capabilities
 * 2. Fallbacks for unsupported features
 * 3. Abstractions for browser-specific implementations
 */

/**
 * Check if WebHID is supported by the browser
 * @returns {boolean} - True if WebHID is supported
 */
function supportsWebHID() {
  return 'hid' in navigator;
}

/**
 * Safely attempt to use WebHID to connect to hardware wallets
 * @returns {Promise<Object>} - Result of the WebHID request, or error object
 */
async function requestHIDDevices() {
  if (!supportsWebHID()) {
    return { 
      success: false, 
      error: 'WebHID not supported in this browser',
      alternativeMethod: 'Use the device vendor\'s browser extension or desktop application'
    };
  }

  try {
    // Define filters for common hardware wallets
    const filters = [
      // Ledger
      { vendorId: 0x2c97 },
      // Trezor
      { vendorId: 0x534c },
      // KeepKey
      { vendorId: 0x2b24 }
    ];

    const devices = await navigator.hid.requestDevice({ filters });
    return { success: true, devices };
  } catch (error) {
    console.error('Error accessing HID devices:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to access HID devices'
    };
  }
}

/**
 * Check if the browser supports the Web Crypto API
 * @returns {boolean} - True if Web Crypto is fully supported
 */
function supportsWebCrypto() {
  return window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function';
}

/**
 * Safely hash data using Web Crypto when available
 * @param {Uint8Array} data - The data to hash
 * @returns {Promise<Uint8Array>} - The resulting hash
 */
async function sha256Hash(data) {
  if (supportsWebCrypto()) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  } else {
    // Fallback to a JavaScript implementation
    // This is a simplified placeholder - in production you'd use a proper JS crypto library
    console.warn('Web Crypto not supported, using fallback implementation');
    
    // Import a JS crypto library dynamically
    const CryptoJS = await import('https://cdn.jsdelivr.net/npm/crypto-js@4.1.1/crypto-js.js');
    const wordArray = CryptoJS.lib.WordArray.create(data);
    const hash = CryptoJS.SHA256(wordArray);
    
    // Convert CryptoJS format to Uint8Array
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      result[i] = parseInt(hash.toString(CryptoJS.enc.Hex).substring(i * 2, i * 2 + 2), 16);
    }
    
    return result;
  }
}

/**
 * Check if the browser supports localStorage
 * @returns {boolean} - True if localStorage is available
 */
function supportsLocalStorage() {
  try {
    const testKey = '__test_storage__';
    localStorage.setItem(testKey, testKey);
    const result = localStorage.getItem(testKey) === testKey;
    localStorage.removeItem(testKey);
    return result;
  } catch (e) {
    return false;
  }
}

/**
 * Storage abstraction that falls back to memory storage if localStorage isn't available
 */
const safeStorage = {
  _memoryStorage: new Map(),
  
  getItem(key) {
    if (supportsLocalStorage()) {
      return localStorage.getItem(key);
    }
    return this._memoryStorage.get(key) || null;
  },
  
  setItem(key, value) {
    if (supportsLocalStorage()) {
      localStorage.setItem(key, value);
    } else {
      this._memoryStorage.set(key, value);
    }
  },
  
  removeItem(key) {
    if (supportsLocalStorage()) {
      localStorage.removeItem(key);
    } else {
      this._memoryStorage.delete(key);
    }
  },
  
  clear() {
    if (supportsLocalStorage()) {
      localStorage.clear();
    } else {
      this._memoryStorage.clear();
    }
  }
};

/**
 * Check if the connection is secure (HTTPS)
 * @returns {boolean} - True if using HTTPS
 */
function isSecureContext() {
  return window.isSecureContext || location.protocol === 'https:';
}

/**
 * Get information about the current browser environment
 * @returns {Object} - Browser details
 */
function getBrowserInfo() {
  const userAgent = navigator.userAgent;
  let browserName = "Unknown";
  let browserVersion = "Unknown";
  let isChrome = false;
  let isFirefox = false;
  let isEdge = false;
  let isOpera = false;
  let isSafari = false;
  
  if (userAgent.indexOf("Firefox") > -1) {
    browserName = "Firefox";
    isFirefox = true;
    browserVersion = userAgent.match(/Firefox\/([0-9.]+)/)[1];
  } else if (userAgent.indexOf("Edge") > -1) {
    browserName = "Edge";
    isEdge = true;
    browserVersion = userAgent.match(/Edge\/([0-9.]+)/)[1];
  } else if (userAgent.indexOf("Edg") > -1) {
    browserName = "Edge";
    isEdge = true;
    browserVersion = userAgent.match(/Edg\/([0-9.]+)/)[1];
  } else if (userAgent.indexOf("OPR") > -1 || userAgent.indexOf("Opera") > -1) {
    browserName = "Opera";
    isOpera = true;
    browserVersion = userAgent.match(/(?:OPR|Opera)\/([0-9.]+)/)[1];
  } else if (userAgent.indexOf("Chrome") > -1) {
    browserName = "Chrome";
    isChrome = true;
    browserVersion = userAgent.match(/Chrome\/([0-9.]+)/)[1];
  } else if (userAgent.indexOf("Safari") > -1) {
    browserName = "Safari";
    isSafari = true;
    browserVersion = userAgent.match(/Version\/([0-9.]+)/)[1];
  }
  
  return {
    browserName,
    browserVersion,
    isChrome,
    isFirefox,
    isEdge,
    isOpera,
    isSafari,
    isExtension: !!chrome?.runtime?.id || !!browser?.runtime?.id,
    supportsWebHID: supportsWebHID(),
    supportsWebCrypto: supportsWebCrypto(),
    supportsLocalStorage: supportsLocalStorage(),
    isSecureContext: isSecureContext()
  };
}

// Export the functions
export {
  supportsWebHID,
  requestHIDDevices,
  supportsWebCrypto,
  sha256Hash,
  supportsLocalStorage,
  safeStorage,
  isSecureContext,
  getBrowserInfo
};