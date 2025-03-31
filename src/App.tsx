import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Account } from './interfaces/Account';
import AccountDetails from './components/AccountDetails';
import Settings from './components/settings/Settings';
import {
  createAccount,
  importAccount,
  saveAccount,
  getExistingAccountByPrivateKey,
  verifyPassword
} from './wallet-utils/AccountUtils';
import { Chain, ethereum, CHAINS_CONFIG } from './interfaces/Chain'; // Import CHAINS_CONFIG
import ConnectApproval from './components/connection/ConnectApproval';
import TransactionApproval from './components/transaction/TransactionApproval';

// Define message types for extension communication
const MessageTypes = {
  // ... (keep existing message types)
  APPROVE_TRANSACTION: 'APPROVE_TRANSACTION', // Add new types
  REJECT_TRANSACTION: 'REJECT_TRANSACTION',
  APPROVE_CONNECTION: 'APPROVE_CONNECTION', // Add for consistency
  REJECT_CONNECTION: 'REJECT_CONNECTION', // Add for consistency
};

function App() {
  // State variables
  const [account, setAccount] = useState<Account | null>(null);
  const [privateKey, setPrivateKey] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [selectedChain, setSelectedChain] = useState<Chain>(ethereum); // Default chain
  const [showReceive, setShowReceive] = useState<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Password states
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showCreatePasswordForm, setShowCreatePasswordForm] = useState<boolean>(false);
  const [importPassword, setImportPassword] = useState<string>("");

  // Extension-specific states
  const [pendingConnectRequest, setPendingConnectRequest] = useState<any>(null);
  const [pendingTransaction, setPendingTransaction] = useState<any>(null); // Add state for pending tx
  const [isExtension, setIsExtension] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true); // Add loading state

  // --- Lifecycle hooks ---
  useEffect(() => {
    setIsLoading(true);
    let loadedAccount: Account | null = null;
    let loadedTheme: 'light' | 'dark' = 'light';
    let loadedChainId: string = ethereum.chainId;
    const isExtension = Boolean(chrome?.runtime?.id);
    setIsExtension(isExtension);

    const initializeWallet = async () => {
      try {
        // Only run storage operations if we're in extension context
        if (isExtension) {
          const result = await new Promise<{ [key: string]: any }>((resolve) => {
            chrome.storage.local.get(['account', 'wallet-theme', 'selectedChainId', 'state', 'pendingConnectRequest', 'pendingTransaction'], resolve);
          });

          if (result.account) {
            loadedAccount = JSON.parse(result.account);
            setAccount(loadedAccount); // Set account early for other checks
          }
          if (result['wallet-theme'] === 'dark') {
            loadedTheme = 'dark';
          }
          // Load selectedChainId from state if available, otherwise fallback
          loadedChainId = result.state?.selectedChainId || result.selectedChainId || ethereum.chainId;

          // Check for pending requests based on URL params
          const urlParams = new URLSearchParams(window.location.search);
          const requestType = urlParams.get('requestType');
          const requestId = urlParams.get('requestId');

          console.log(`URL params: requestType=${requestType}, requestId=${requestId}`);

          if (requestType === 'transaction' && requestId) {
            if (result.pendingTransaction && result.pendingTransaction.id === requestId) {
              console.log('Setting pending transaction in state:', result.pendingTransaction);
              setPendingTransaction(result.pendingTransaction);
              // Ensure the correct chain is selected for the transaction
              loadedChainId = result.pendingTransaction.chainId || loadedChainId;
            } else {
              console.error("Transaction request not found in storage or ID mismatch.");
              console.error("Found:", result.pendingTransaction?.id);
              console.error("Expected:", requestId);
            }
          } else if (requestType === 'connect' && requestId) {
             // First check if we already have a pending connect request in our storage fetch
             if (result.pendingConnectRequest && result.pendingConnectRequest.id === requestId) {
                console.log('Setting pending connect request in state from initial fetch:', result.pendingConnectRequest);
                setPendingConnectRequest(result.pendingConnectRequest);
             } else {
                // If not found in initial fetch, try a dedicated fetch just for this request
                console.log('Fetching connection request specifically...');
                const connectResult = await new Promise<{ [key: string]: any }>((resolve) => {
                   chrome.storage.local.get(['pendingConnectRequest'], resolve);
                });
                
                console.log('Retrieved connect request data:', connectResult);
                
                if (connectResult.pendingConnectRequest && connectResult.pendingConnectRequest.id === requestId) {
                   console.log('Setting pending connect request in state:', connectResult.pendingConnectRequest);
                   setPendingConnectRequest(connectResult.pendingConnectRequest);
                } else {
                   console.error("Connection request not found or ID mismatch.");
                   console.error("Found:", connectResult.pendingConnectRequest?.id);
                   console.error("Expected:", requestId);
                }
             }
          }
        } 

        // Set the loaded chain
        if (loadedChainId) {
          const chain = CHAINS_CONFIG[loadedChainId] || ethereum;
          setSelectedChain(chain);
        }

        setTheme(loadedTheme);
        setIsLoading(false);
      }
      catch (error) {
        console.error("Error initializing wallet:", error);
        setIsLoading(false);
      }
    }

    initializeWallet();
  }, []);


  // Save account data whenever it changes
  useEffect(() => {
    if (isLoading) return; // Don't save while initially loading
    if (isExtension) {
      if (account) {
        chrome.storage.local.set({ account: JSON.stringify(account) });
      } else {
        chrome.storage.local.remove(['account']);
      }
    } else {
      saveAccount(account);
    }
  }, [account, isExtension, isLoading]);

  // Save selected chain whenever it changes
  useEffect(() => {
     if (isLoading) return; // Don't save while initially loading
     const chainIdToSave = selectedChain.chainId;
     if (isExtension) {
        // Save to background state as well for consistency
        chrome.runtime.sendMessage({ type: 'SET_STATE', payload: { selectedChainId: chainIdToSave } });
        // Also save directly to local storage for faster popup load next time
        chrome.storage.local.set({ selectedChainId: chainIdToSave });
     } else {
        localStorage.setItem('selectedChainId', chainIdToSave);
     }
  }, [selectedChain, isExtension, isLoading]);


  // Toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);

    if (newTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    if (isExtension) {
      chrome.storage.local.set({ 'wallet-theme': newTheme });
    } else {
      localStorage.setItem('wallet-theme', newTheme);
    }
  };

  // --- Approval Handlers ---

  // Handle approve connect
  const handleApproveConnect = useCallback(() => {
    if (!pendingConnectRequest || !account) return;
    
    console.log(`Approving connect request: ${pendingConnectRequest.id} with account: ${account.address}`);
    
    // Set processing state
    setIsLoading(true);
    
    // Send approval message to background script
    chrome.runtime.sendMessage({
      type: 'CONNECT_RESPONSE',
      requestId: pendingConnectRequest.id,
      approved: true,
      accounts: [account.address]  // Pass account address explicitly
    }, (response) => {
      const error = (chrome.runtime as any).lastError;
      if (error) {
        console.error('Error sending connect response:', error.message);
      } else {
        console.log('Connect response sent successfully:', response);
      }
      
      // Clear the pending request
      setPendingConnectRequest(null);
      setIsLoading(false);
      
      // Close the popup window after processing
      if (isExtension) {
        window.close();
      }
    });
  }, [pendingConnectRequest, account, isExtension]);

  // Handle reject connect
  const handleRejectConnect = useCallback(() => {
    if (!pendingConnectRequest) return;
    
    // Set processing state
    setIsLoading(true);
    
    console.log(`Rejecting connect request: ${pendingConnectRequest.id}`);
    
    // Send rejection message to background script
    chrome.runtime.sendMessage({
      type: 'CONNECT_RESPONSE',
      requestId: pendingConnectRequest.id,
      approved: false,
      accounts: []
    }, (response) => {
      const error = (chrome.runtime as any).lastError;
      if (error) {
        console.error('Error sending connect rejection:', error.message);
      } else {
        console.log('Connect rejection sent successfully:', response);
      }
      
      // Clear the pending request
      setPendingConnectRequest(null);
      setIsLoading(false);
      
      // Close popup if opened for this request
      if (isExtension) {
        window.close();
      }
    });
  }, [pendingConnectRequest, isExtension]);

  // Handlers for approving/rejecting transactions from the component (New)
  const handleApproveTransaction = (requestId: string) => {
    chrome.runtime.sendMessage({ type: MessageTypes.APPROVE_TRANSACTION, requestId }, (response) => {
      console.log('Approve transaction response from background:', response);
      if (response && response.success) {
         window.close(); // Close popup on success
      } else {
         // Handle error display in the popup
         // TODO: Show error more gracefully than alert
         alert(`Approval failed: ${response?.error || 'Unknown error'}`);
         // Optionally keep the popup open on failure? Or close anyway?
         // window.close();
      }
    });
  };

  const handleRejectTransaction = (requestId: string) => {
    chrome.runtime.sendMessage({ type: MessageTypes.REJECT_TRANSACTION, requestId }, (response) => {
      console.log('Reject transaction response from background:', response);
      // Always close popup on rejection attempt
      window.close();
    });
  };

  // --- End Approval Handlers ---


  // Show password form before creating account
  const handleShowCreateForm = () => {
    setShowCreatePasswordForm(true);
    setError("");
  };

  // Create a new random wallet account with password
  const handleCreateAccount = () => {
    if (!password) {
      setError("Please enter a password");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    const newAccount = createAccount(password);
    setAccount(newAccount);
    setError("");
    setPassword("");
    setConfirmPassword("");
    setShowCreatePasswordForm(false);
  };

  // Import an existing account from private key
  const handleImportAccount = () => {
    setError("");
    try {
      if (!privateKey || privateKey.length !== 66 || !privateKey.startsWith("0x")) {
        throw new Error("Please enter a valid private key (66 characters long, starting with 0x)");
      }
      if (!importPassword) {
        throw new Error("Please enter a password to protect your private key");
      }
      const existingAccount = getExistingAccountByPrivateKey(privateKey);
      if (existingAccount && existingAccount.passwordHash) {
        if (!verifyPassword(importPassword, existingAccount.passwordHash)) {
          throw new Error("Incorrect password for this private key");
        }
        setAccount(existingAccount);
      } else {
        const importedAccount = importAccount(privateKey, importPassword);
        setAccount(importedAccount);
      }
      setPrivateKey("");
      setImportPassword("");
    } catch (err: any) {
      setError(err.message || "Invalid private key format");
    }
  };

  // Toggle settings panel
  const toggleSettings = () => {
    setShowSettings(!showSettings);
  };

  // Toggle between send and receive view
  const toggleReceiveView = () => {
    if (account) {
      setShowReceive(!showReceive);
    }
  };

  // Handle home button click - go back to main wallet view
  const handleHomeClick = () => {
    setShowSettings(false);
  };

  // Handle network change with notification to connected sites if extension
  const handleNetworkChange = (chain: Chain) => {
    setSelectedChain(chain);
    // Saving is handled by the useEffect hook for selectedChain
  };

  // Handle logout and clear saved account
  const handleLogout = () => {
    const oldAddress = account?.address;
    setAccount(null);

    // If extension, notify background to update state and potentially connected sites
    if (isExtension && oldAddress) {
      chrome.runtime.sendMessage({
        type: 'LOGOUT', // Use a specific type for logout
        payload: { address: oldAddress } // Send address that logged out
      });
    }
  };


  // --- Conditional Rendering ---

  if (isLoading) {
     // Basic loading indicator
     return <div className="App"><div className="loading-indicator">Loading Wallet...</div></div>;
  }

  // Render connection approval UI if pending
  if (isExtension && pendingConnectRequest && account) {
     console.log("Rendering connection approval UI for request:", pendingConnectRequest);
     return (
        <div className="App">
          {/* Minimal header for approval screens */}
          <header className="App-header approval-header">
             <h1 className="app-title">Cross-Net Wallet</h1>
          </header>
          <ConnectApproval
            origin={pendingConnectRequest.origin}
            account={account}
            // Pass chain name from the currently selected chain in the popup state
            chainName={selectedChain.chainName}
            // Update props to use the specific handlers
            onApprove={handleApproveConnect} 
            onReject={handleRejectConnect}
          />
        </div>
     );
  }

  // Render transaction approval UI if pending
  if (isExtension && pendingTransaction && account && selectedChain) {
     // Ensure the selectedChain matches the transaction's chainId if possible
     // This might already be handled in the loading useEffect
     const chainForTx = CHAINS_CONFIG[pendingTransaction.chainId] || selectedChain;

     return (
        <div className="App">
           {/* Minimal header for approval screens */}
           <header className="App-header approval-header">
             <h1 className="app-title">Cross-Net Wallet</h1>
           </header>
           <TransactionApproval
             pendingTx={pendingTransaction} // Pass the whole pendingTx object
             account={account}
             selectedChain={chainForTx} // Use the chain relevant to the tx
             onApprove={handleApproveTransaction} // Use new handler
             onReject={handleRejectTransaction}   // Use new handler
           />
        </div>
     );
  }

  // --- Regular Wallet UI ---

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="app-title">
          {isExtension ? 'Cross-Net Wallet' : 'Mini Wallet'}
        </h1>

        {/* Theme Toggle Button */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        {!account ? (
          // --- Login/Create Account View ---
          <div className="wallet-container">
            <div className="wallet-form">
              <h2 className="form-title">Get Started</h2>

              {!showCreatePasswordForm ? (
                <button
                  onClick={handleShowCreateForm}
                  className="btn btn-primary"
                >
                  Create New Wallet
                </button>
              ) : (
                <div className="auth-form">
                  <div className="form-group">
                    <label className="form-label">Password:</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter a secure password"
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm Password:</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your password"
                      className="form-input"
                    />
                  </div>
                  <div className="auth-buttons">
                    <button
                      onClick={handleCreateAccount}
                      disabled={!password || !confirmPassword}
                      className={`btn btn-primary ${(!password || !confirmPassword) ? 'btn-disabled' : ''}`}
                    >
                      Create Wallet
                    </button>
                    <button
                      onClick={() => setShowCreatePasswordForm(false)}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="divider">
                <div className="divider-line"></div>
                <span className="divider-text">OR</span>
                <div className="divider-line"></div>
              </div>

              <div className="form-group">
                <label className="form-label">Import with Private Key:</label>
                <input
                  type="text" // Changed back to text for visibility, consider password type
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="Enter your private key (0x...)"
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Set Password:</label>
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Enter a secure password"
                  className="form-input"
                />
              </div>
              <button
                onClick={handleImportAccount}
                disabled={!privateKey || !importPassword}
                className={`btn btn-success ${(!privateKey || !importPassword) ? 'btn-disabled' : ''}`}
              >
                Import Wallet
              </button>

              {error && <p className="error-message">{error}</p>}
            </div>
          </div>
        ) : (
          // --- Logged In View ---
          <div className="wallet-container">
            {showSettings ? (
              <Settings
                selectedChain={selectedChain}
                onNetworkChange={handleNetworkChange}
                account={account}
              />
            ) : (
              <>
                {/* Account details component */}
                <AccountDetails
                  account={account}
                  selectedChain={selectedChain}
                  onOpenSettings={toggleSettings}
                />
              </>
            )}

            {/* Buttons visible only when logged in */}
            <div className="wallet-form logged-in-actions">
              {showSettings && (
                <button
                  onClick={toggleSettings} // Use toggleSettings to go back
                  className="btn btn-secondary"
                >
                  Back to Wallet
                </button>
              )}
              {/* Logout button is now part of the footer/navigation */}
            </div>

            {/* Add a debug information section when in development mode */}
            {isExtension && process.env.NODE_ENV === 'development' && (
              <div className="debug-info">
                <p>URL Params: {window.location.search}</p>
                <p>Has Pending Connect: {pendingConnectRequest ? 'Yes' : 'No'}</p>
                <p>Has Pending Transaction: {pendingTransaction ? 'Yes' : 'No'}</p>
                <button onClick={() => console.log({pendingConnectRequest, pendingTransaction})}>
                  Log Pending Requests
                </button>
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  );
}

export default App;