/// <reference types="react-scripts" />

// Chrome Extension API type definitions
declare namespace chrome {
  interface Runtime {
    lastError: any;
    id?: string;
    sendMessage: (message: any, callback?: (response: any) => void) => void;
    onMessage: {
      addListener: (
        callback: (
          message: any,
          sender: any,
          sendResponse: (response?: any) => void
        ) => void | boolean
      ) => void;
    };
  }

  interface Storage {
    local: {
      get: (keys: string | string[] | object | null, callback: (items: any) => void) => void;
      set: (items: object, callback?: () => void) => void;
      remove: (keys: string | string[], callback?: () => void) => void;
      clear: (callback?: () => void) => void;
    };
    sync: {
      get: (keys: string | string[] | object | null, callback: (items: any) => void) => void;
      set: (items: object, callback?: () => void) => void;
      remove: (keys: string | string[], callback?: () => void) => void;
      clear: (callback?: () => void) => void;
    };
  }

  interface Windows {
    create: (
      createData: {
        url?: string;
        type?: string;
        width?: number;
        height?: number;
        left?: number;
        top?: number;
      },
      callback?: (window: any) => void
    ) => void;
  }

  interface Tabs {
    query: (
      queryInfo: {
        active?: boolean;
        currentWindow?: boolean;
        url?: string | string[];
        [key: string]: any;
      },
      callback: (result: any[]) => void
    ) => void;
    sendMessage: (tabId: number, message: any, callback?: (response: any) => void) => void;
  }

  const runtime: Runtime;
  const storage: Storage;
  const windows: Windows;
  const tabs: Tabs;
}

// Define the structure of the response from sendTransaction
interface SendTransactionResponse {
  approved: boolean;
  result?: string; // Transaction hash if approved, otherwise might be undefined
  message?: string; // Optional message, e.g., for rejection reason
}

// Cross-Net Wallet definitions
interface CrossNetWallet {
  isConnected: boolean;
  accounts: string[];
  chainId: string | null;
  
  // Core methods
  request: (request: { method: string; params?: any[] }) => Promise<any>;
  connect: () => Promise<string[]>;
  getAccounts: () => Promise<string[]>;
  getChainId: () => Promise<string>;
  
  // Transaction methods
  sendTransaction: (transaction: any) => Promise<SendTransactionResponse>;
  signTransaction: (transaction: any) => Promise<string>;
  getBalance: (address?: string, chainId?: string) => Promise<any>;
  
  // Event methods
  on: (eventName: string, listener: (...args: any[]) => void) => () => void;
  removeListener: (eventName: string, listener: (...args: any[]) => void) => void;
  emit: (eventName: string, ...args: any[]) => void;
}

declare interface Window {
  crossNetWallet?: CrossNetWallet;
  ethereum?: CrossNetWallet; // For compatibility with existing dApps
}
