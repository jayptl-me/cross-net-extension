import React, { useState, useEffect, useRef } from "react";
import { Account } from "../interfaces/Account";
import { ethers } from "ethers";
import { Chain } from "../interfaces/Chain";
import { sendToken, getBalance, testRpcConnection } from "../wallet-utils/TransactionUtils";
import { QRCodeSVG } from "qrcode.react";
import * as Tabs from '@radix-ui/react-tabs';
import * as Toast from '@radix-ui/react-toast';
import { Alchemy, Network, AssetTransfersCategory, AssetTransfersResponse } from "alchemy-sdk";

interface AccountDetailProps {
  account: Account;
  selectedChain: Chain;
  onOpenSettings: () => void;
}

// Interface for transaction history items
interface TransactionHistoryItem {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number | null;
  category: string;
  asset: string;
  blockNum: number | string;
}

const AccountDetails: React.FC<AccountDetailProps> = ({ 
  account,
  selectedChain,
  onOpenSettings
}) => {
  const [destinationAddress, setDestinationAddress] = useState("");
  const [amount, setAmount] = useState<number | "">(""); // Allow empty string for better UX
  const [balance, setBalance] = useState(account.balance);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [networkResponse, setNetworkResponse] = useState<{
    status: null | "pending" | "complete" | "error";
    message: string | React.ReactElement;
    txHash?: string; // Add transaction hash for missing response errors
  }>({ status: null, message: "" });
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');
  
  // Add states for transaction history
  const [transactionHistory, setTransactionHistory] = useState<TransactionHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  // Add states for transaction confirmation
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<{
    to: string;
    amount: number;
    gasPrice: string;
    gasCost: string;
    totalCost: string;
    estimatedTime: string;
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  // Store the last transaction attempt details for retry functionality
  const lastTransactionRef = useRef<{
    amount: number;
    to: string;
    from: string;
    chainId: string;
  } | null>(null);

  // Function to fetch and update the balance of the account
  const fetchData = async () => {
    try {
      setIsRefreshing(true);
      const formattedBalance = await getBalance(account.address, selectedChain);
      // Format the balance to four decimal places
      setBalance(String(parseFloat(formattedBalance).toFixed(4)));
      
      // Show toast notification for balance update
      setToastMessage("Balance updated successfully");
      setToastType("success");
      setToastOpen(true);
    } catch (error) {
      console.error("Error fetching balance:", error);
      setToastMessage("Failed to update balance");
      setToastType("error");
      setToastOpen(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Function to prepare transaction for confirmation
  const prepareTransaction = async () => {
    if (!amount || !destinationAddress) {
      setNetworkResponse({ 
        status: "error", 
        message: "Please enter both destination address and amount" 
      });
      return;
    }

    // Validate destination address format
    if (!ethers.utils.isAddress(destinationAddress)) {
      setNetworkResponse({ 
        status: "error", 
        message: "Invalid wallet address format. Please check the destination address." 
      });
      return;
    }

    // Validate amount is positive
    if (typeof amount === 'number' && amount <= 0) {
      setNetworkResponse({ 
        status: "error", 
        message: "Amount must be greater than 0" 
      });
      return;
    }
    
    setIsLoadingPreview(true);
    setPreviewError(null);
    setNetworkResponse({ status: null, message: "" });
    
    try {
      // Check network connectivity first
      const isConnected = await testRpcConnection(selectedChain.rpcUrl);
      if (!isConnected) {
        throw new Error(`Could not connect to ${selectedChain.chainName} network. Please check your internet connection and try again.`);
      }
      
      // Get a provider and estimate gas cost
      const provider = new ethers.providers.JsonRpcProvider(selectedChain.rpcUrl);
      const wallet = new ethers.Wallet(account.privateKey, provider);
      
      // Get current gas price
      const gasPrice = await provider.getGasPrice();
      const formattedGasPrice = ethers.utils.formatUnits(gasPrice, "gwei");
      
      // Standard gas limit for ETH transfers
      const gasLimit = 21000;
      const gasCost = gasPrice.mul(gasLimit);
      const formattedGasCost = ethers.utils.formatEther(gasCost);
      
      // Calculate total cost (amount + gas)
      const amountValue = typeof amount === 'string' ? parseFloat(amount) : amount;
      const amountWei = ethers.utils.parseEther(amountValue.toString());
      const totalCost = amountWei.add(gasCost);
      const formattedTotalCost = ethers.utils.formatEther(totalCost);
      
      // Estimate confirmation time based on gas price
      let estimatedTime = "< 30 seconds";
      if (parseFloat(formattedGasPrice) < 10) {
        estimatedTime = "1-2 minutes";
      } else if (parseFloat(formattedGasPrice) > 100) {
        estimatedTime = "< 15 seconds";
      }
      
      // Set transaction details for confirmation
      setTransactionDetails({
        to: destinationAddress,
        amount: amountValue,
        gasPrice: `${formattedGasPrice} Gwei`,
        gasCost: `${formattedGasCost} ${selectedChain.currencySymbol}`,
        totalCost: `${formattedTotalCost} ${selectedChain.currencySymbol}`,
        estimatedTime
      });
      
      // Show the confirmation dialog
      setShowConfirmation(true);
    } catch (error: any) {
      console.error("Error preparing transaction:", error);
      setPreviewError(error.message || "Failed to prepare transaction preview");
      setNetworkResponse({ 
        status: "error", 
        message: error.message || "Failed to prepare transaction" 
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Function to handle ETH transfer after confirmation
  const transfer = async () => {
    // Hide confirmation dialog
    setShowConfirmation(false);
    
    setNetworkResponse({ status: "pending", message: "Processing transaction..." });
    try {
      // Store transaction details for possible retry
      lastTransactionRef.current = {
        amount: typeof amount === 'string' ? parseFloat(amount) : amount,
        to: destinationAddress,
        from: account.address,
        chainId: selectedChain.chainId
      };
      
      // Show detailed status update
      setNetworkResponse({ 
        status: "pending", 
        message: `Sending ${amount} ${selectedChain.currencySymbol} to ${destinationAddress.substring(0, 6)}...${destinationAddress.substring(destinationAddress.length - 4)}` 
      });
      
      const result = await sendToken(
        typeof amount === 'string' ? parseFloat(amount) : amount, 
        account.address, 
        destinationAddress, 
        account.privateKey,
        selectedChain.chainId
      );
      
      const { receipt, transaction, possiblySucceeded } = result;
      
      if (receipt && receipt.status === 1) {
        setNetworkResponse({
          status: "complete",
          message: (
            <p>
              Transfer complete!{" "}
              <a
                href={`${selectedChain.blockExplorerUrl}/tx/${receipt.transactionHash}`}
                target="_blank"
                rel="noreferrer"
                className="address-link"
              >
                View transaction
              </a>
            </p>
          ),
        });
        // Clear fields after successful transfer
        setAmount("");
        setDestinationAddress("");
        lastTransactionRef.current = null;
        // Refresh balance after successful transfer
        fetchData();
      } else if (possiblySucceeded) {
        // Transaction might have succeeded but we couldn't get confirmation
        setNetworkResponse({
          status: "pending",
          message: (
            <div>
              <p>
                Transaction might have succeeded, but we couldn't get confirmation due to network issues.
              </p>
              <p>Please:</p>
              <ul>
                <li>Check your wallet balance in a few minutes</li>
                <li>Look for the transaction on the block explorer</li>
                <li>Refresh your balance using the refresh button</li>
              </ul>
              <button 
                onClick={fetchData}
                className="btn btn-info mt-10"
              >
                Refresh Balance
              </button>
            </div>
          )
        });
        
        // Schedule a balance refresh in 30 seconds
        setTimeout(() => {
          fetchData();
        }, 30000);
      } else if (transaction && transaction.hash && transaction.hash.startsWith("0x") && transaction.hash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        // If we have a valid transaction hash but no receipt, it might still be pending
        setNetworkResponse({ 
          status: "pending", 
          message: (
            <p>
              Transaction submitted and waiting for confirmation.{" "}
              <a
                href={`${selectedChain.blockExplorerUrl}/tx/${transaction.hash}`}
                target="_blank"
                rel="noreferrer"
                className="address-link"
              >
                View transaction
              </a>
            </p>
          ),
          txHash: transaction.hash
        });
      } else if (result.pending) {
        // The transaction is pending without confirmation
        const message = result.message || "Transaction submitted but not yet confirmed. Check back later.";
        setNetworkResponse({ 
          status: "pending", 
          message 
        });
      } else {
        setNetworkResponse({ status: "error", message: JSON.stringify(result) });
      }
    } catch (error: any) {
      console.error("Transfer error:", error);
      
      // Check if this is a missing response error
      if (error.message.includes("missing response")) {
        setNetworkResponse({ 
          status: "error", 
          message: (
            <div>
              <p>The network did not respond properly. Your transaction might still be processing.</p>
              <p>You can:</p>
              <ul>
                <li>Wait a few minutes and check your balance</li>
                <li>Look up your address on the block explorer</li>
                <li>Try again with the retry button below</li>
              </ul>
              <button 
                onClick={prepareTransaction}
                className="btn btn-info mt-10"
              >
                Retry Transaction
              </button>
            </div>
          )
        });
      } else {
        setNetworkResponse({ 
          status: "error", 
          message: error.reason || error.message || JSON.stringify(error) 
        });
      }
    }
  };

  // Function to copy wallet address to clipboard
  const copyAddressToClipboard = () => {
    navigator.clipboard.writeText(account.address)
      .then(() => {
        setToastMessage('Address copied to clipboard!');
        setToastType('success');
        setToastOpen(true);
      })
      .catch(err => {
        console.error('Failed to copy address: ', err);
        setToastMessage('Failed to copy address');
        setToastType('error');
        setToastOpen(true);
      });
  };

  // Function to fetch transaction history
  const fetchTransactionHistory = async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      // Determine network based on selected chain
      let network;
      switch (selectedChain.chainId) {
        case '1': 
          network = Network.ETH_MAINNET;
          break;
        case '5': 
          network = Network.ETH_GOERLI;
          break;
        case '137': 
          network = Network.MATIC_MAINNET;
          break;
        case '80001': 
          network = Network.MATIC_MUMBAI;
          break;
        case '10': 
          network = Network.OPT_MAINNET;
          break;
        case '420': 
          network = Network.OPT_GOERLI;
          break;
        default:
          network = Network.ETH_GOERLI; // Default to Goerli for testing
      }

      const alchemy = new Alchemy({
        apiKey: process.env.REACT_APP_ALCHEMY_API_KEY || "",
        network: network,
      });

      // Fetch transactions sent from this address
      const sentTransfersResponse = await alchemy.core.getAssetTransfers({
        fromBlock: "0x0",
        toBlock: "latest",
        fromAddress: account.address,
        category: [AssetTransfersCategory.EXTERNAL, AssetTransfersCategory.INTERNAL, AssetTransfersCategory.ERC20],
      });

      // Fetch transactions received by this address
      const receivedTransfersResponse = await alchemy.core.getAssetTransfers({
        fromBlock: "0x0",
        toBlock: "latest",
        toAddress: account.address,
        category: [AssetTransfersCategory.EXTERNAL, AssetTransfersCategory.INTERNAL, AssetTransfersCategory.ERC20],
      });

      // Combine and format transactions
      const allTransfers = [
        ...sentTransfersResponse.transfers.map((tx: any) => ({
          ...tx,
          direction: 'sent'
        })),
        ...receivedTransfersResponse.transfers.map((tx: any) => ({
          ...tx,
          direction: 'received'
        }))
      ];

      // Sort by block number in descending order (most recent first)
      allTransfers.sort((a, b) => b.blockNum - a.blockNum);

      // Set the formatted transactions in state
      setTransactionHistory(allTransfers);

      // If no transactions were found, show a message
      if (allTransfers.length === 0) {
        console.log("No transaction history found for this address");
      }
    } catch (error: any) {
      console.error("Error fetching transaction history:", error);
      setHistoryError("Failed to fetch transaction history: " + (error.message || "Unknown error"));
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchTransactionHistory();
  }, [account.address, selectedChain]);

  return (
    <Toast.Provider swipeDirection="right">
      <div className="account-card">
        <div className="account-header">
          <h2 className="form-title">Account Details</h2>
          <button 
            className="btn btn-icon settings-btn"
            onClick={onOpenSettings}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
        
        <div className="network-badge">
          Network: {selectedChain.chainName}
        </div>
        
        <div className="form-group">
          <h3 className="form-label">Address:</h3>
          <div className="address-display">
            <a
              target="_blank"
              rel="noreferrer"
              href={`${selectedChain.blockExplorerUrl}/address/${account.address}`}
              className="address-link"
            >
              {account.address}
            </a>
            <button 
              onClick={copyAddressToClipboard}
              className="btn btn-copy btn-small"
              title="Copy address to clipboard"
            >
              📋
            </button>
          </div>
        </div>
        
        <div className="form-group">
          <div className="balance-container">
            <div className="balance-label">
              <span className="form-label">Balance:</span>
            </div>
            <div className="balance-value">
              {balance} {selectedChain.currencySymbol}
              <button 
                className="btn btn-icon refresh-btn"
                onClick={fetchData} 
                disabled={isRefreshing}
                title="Refresh balance"
              >
                {isRefreshing ? '⌛' : '🔄'}
              </button>
            </div>
          </div>
        </div>

        <Tabs.Root className="tabs-root" defaultValue="send">
          <Tabs.List className="tabs-list" aria-label="Manage your wallet">
            <Tabs.Trigger className="tabs-trigger" value="send">
              Send {selectedChain.currencySymbol}
            </Tabs.Trigger>
            <Tabs.Trigger className="tabs-trigger" value="receive">
              Receive {selectedChain.currencySymbol}
            </Tabs.Trigger>
            <Tabs.Trigger className="tabs-trigger" value="history">
              Transaction History
            </Tabs.Trigger>
          </Tabs.List>
          
          <Tabs.Content className="tabs-content" value="send">
            <div className="send-container">
              <h3 className="send-title">Send {selectedChain.currencySymbol}</h3>
              <div className="form-group">
                <label className="form-label">Destination Address:</label>
                <input
                  type="text"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  className="form-input"
                  placeholder="Enter destination address"
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Amount:</label>
                <div className="amount-input-container">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value ? parseFloat(e.target.value) : "")}
                    className="form-input"
                    placeholder={`Amount in ${selectedChain.currencySymbol}`}
                    min="0"
                    step="0.001"
                  />
                  <span className="currency-symbol">{selectedChain.currencySymbol}</span>
                </div>
              </div>
              
              <button
                onClick={prepareTransaction}
                className={`btn btn-warning ${(!amount || !destinationAddress || networkResponse.status === "pending") ? 'btn-disabled' : ''}`}
                disabled={!amount || !destinationAddress || networkResponse.status === "pending"}
              >
                {networkResponse.status === "pending" ? "Processing..." : `Send ${amount || 0} ${selectedChain.currencySymbol}`}
              </button>
            </div>
          </Tabs.Content>
          
          <Tabs.Content className="tabs-content" value="receive">
            <div className="receive-container">
              <h3 className="receive-title">Receive {selectedChain.currencySymbol}</h3>
              <p className="receive-description">
                Share your address below to receive {selectedChain.currencySymbol} from others.
              </p>
              
              <div className="address-display">
                <p className="wallet-address">{account.address}</p>
                <button 
                  onClick={copyAddressToClipboard}
                  className="btn btn-copy"
                  title="Copy address to clipboard"
                >
                  📋 Copy
                </button>
              </div>
              
              <div className="address-info">
                <p>
                  <strong>Note:</strong> Only send {selectedChain.currencySymbol} to this address on the {selectedChain.chainName} network.
                </p>
              </div>
              
              <div className="qr-code-container">
                <QRCodeSVG 
                  value={account.address}
                  size={200}
                  level="H" // Error correction level
                  includeMargin={true}
                  className="qr-code"
                />
              </div>
            </div>
          </Tabs.Content>
          
          <Tabs.Content className="tabs-content" value="history">
            <div className="history-container">
              <h3 className="history-title">Transaction History</h3>
              
              <div className="history-actions">
                <button 
                  onClick={fetchTransactionHistory} 
                  className="refresh-history-btn"
                  disabled={isLoadingHistory}
                >
                  {isLoadingHistory ? (
                    <>
                      <span className="loading-dot"></span>
                      <span>Refreshing...</span>
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      <span>Refresh History</span>
                    </>
                  )}
                </button>
              </div>
              
              {/* Show scam alert if any potential scam tokens were found */}
              {transactionHistory.some(tx => tx.asset && (
                tx.asset.includes("WWW") || 
                tx.asset.includes(".COM") || 
                tx.asset.includes("Visit") ||
                tx.asset.includes("claim")
              )) && (
                <div className="scam-alert">
                  <span className="scam-alert-icon">⚠️</span>
                  <p className="scam-alert-message">
                    <strong>Warning:</strong> Some transactions appear to be potential scams. Be cautious with tokens that ask you to visit websites or claim rewards.
                  </p>
                </div>
              )}
              
              {historyError && (
                <div className="history-error">
                  <p>{historyError}</p>
                  <p className="error-suggestion">
                    Please check your network connection and try again.
                  </p>
                </div>
              )}
              
              {isLoadingHistory ? (
                <div className="loading-container">
                  <div className="loading-spinner"></div>
                  <p>Loading transactions...</p>
                </div>
              ) : transactionHistory.length > 0 ? (
                <div className="transaction-list">
                  {transactionHistory.map((tx, index) => {
                    const isSent = tx.from.toLowerCase() === account.address.toLowerCase();
                    // Check for potential scam tokens that have URLs in their names
                    const isPotentialScam = tx.asset && (
                      tx.asset.includes("WWW") || 
                      tx.asset.includes(".COM") || 
                      tx.asset.includes("Visit") ||
                      tx.asset.includes("claim")
                    );
                    
                    return (
                      <div key={index} className={`transaction-card ${isSent ? 'sent' : 'received'} ${isPotentialScam ? 'potential-scam' : ''}`}>
                        <div className="transaction-card-header">
                          <div className="transaction-type-badge">
                            <span className={`transaction-badge ${isSent ? 'sent-badge' : 'received-badge'}`}>
                              {isSent ? 'Sent' : 'Received'}
                            </span>
                            <span className="transaction-asset">
                              {tx.asset || selectedChain.currencySymbol}
                              {isPotentialScam && <span className="scam-warning">⚠️ Potential Scam</span>}
                            </span>
                          </div>
                          <div className="transaction-date">
                            {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'Unknown time'}
                          </div>
                        </div>
                        
                        <div className="transaction-card-body">
                          <div className="transaction-detail-row">
                            <div className="detail-label">Amount</div>
                            <div className={`detail-value amount ${isSent ? 'sent-amount' : 'received-amount'}`}>
                              {isSent ? '-' : '+'}{tx.value} {tx.asset || selectedChain.currencySymbol}
                            </div>
                          </div>
                          
                          <div className="transaction-detail-row">
                            <div className="detail-label">{isSent ? 'To' : 'From'}</div>
                            <div className="detail-value address">
                              {isSent 
                                ? `${tx.to.substring(0, 6)}...${tx.to.substring(tx.to.length - 4)}`
                                : `${tx.from.substring(0, 6)}...${tx.from.substring(tx.from.length - 4)}`
                              }
                            </div>
                          </div>
                          
                          {tx.blockNum && (
                            <div className="transaction-detail-row">
                              <div className="detail-label">Block</div>
                              <div className="detail-value block">#{typeof tx.blockNum === 'string' && tx.blockNum.startsWith('0x') 
                                ? tx.blockNum 
                                : tx.blockNum}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="transaction-card-footer">
                          <a
                            href={`${selectedChain.blockExplorerUrl}/tx/${tx.hash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="view-details-link"
                          >
                            View details
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="no-transactions">
                  <p>No transactions found for this address.</p>
                  <p className="no-transactions-suggestion">Try switching to a different network or check back later.</p>
                </div>
              )}
            </div>
          </Tabs.Content>
        </Tabs.Root>

        {networkResponse.status && (
          <div className={`status-box status-${networkResponse.status}`}>
            {networkResponse.status === "pending" && <p className="status-pending">Transfer is pending...</p>}
            {networkResponse.status === "complete" && <div className="status-complete">{networkResponse.message}</div>}
            {networkResponse.status === "error" && (
              <div className="status-error">
                <p className="error-title">Error:</p>
                <div className="error-message">{networkResponse.message}</div>
                {networkResponse.txHash && (
                  <p className="transaction-link">
                    <a
                      href={`${selectedChain.blockExplorerUrl}/tx/${networkResponse.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="address-link"
                    >
                      View transaction on block explorer
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        
        <Toast.Root 
          className={`toast-root toast-${toastType}`} 
          open={toastOpen} 
          onOpenChange={setToastOpen}
        >
          <Toast.Title className="toast-title">
            {toastType === 'success' ? '✅' : toastType === 'error' ? '❌' : 'ℹ️'} 
            {toastType === 'success' ? 'Success' : toastType === 'error' ? 'Error' : 'Info'}
          </Toast.Title>
          <Toast.Description className="toast-description">
            {toastMessage}
          </Toast.Description>
          <Toast.Action className="toast-action" asChild altText="Close">
            <button className="toast-close-btn">×</button>
          </Toast.Action>
        </Toast.Root>
        <Toast.Viewport className="toast-viewport" />
      </div>
      
      {/* Transaction confirmation dialog */}
      {showConfirmation && transactionDetails && (
        <div className="modal-overlay">
          <div className="modal-container transaction-confirmation">
            <div className="modal-header">
              <h3 className="modal-title">Confirm Transaction</h3>
              <button 
                className="modal-close-btn"
                onClick={() => setShowConfirmation(false)}
              >
                ×
              </button>
            </div>
            
            <div className="modal-content">
              <div className="confirmation-details">
                <div className="confirmation-row">
                  <span className="confirmation-label">Network:</span>
                  <span className="confirmation-value network-value">{selectedChain.chainName}</span>
                </div>
                
                <div className="confirmation-row">
                  <span className="confirmation-label">From:</span>
                  <span className="confirmation-value address-value">
                    {account.address.substring(0, 8)}...{account.address.substring(account.address.length - 8)}
                  </span>
                </div>
                
                <div className="confirmation-row">
                  <span className="confirmation-label">To:</span>
                  <span className="confirmation-value address-value">
                    {transactionDetails.to.substring(0, 8)}...{transactionDetails.to.substring(transactionDetails.to.length - 8)}
                  </span>
                </div>
                
                <div className="confirmation-row">
                  <span className="confirmation-label">Amount:</span>
                  <span className="confirmation-value amount-value">
                    {transactionDetails.amount} {selectedChain.currencySymbol}
                  </span>
                </div>
                
                <div className="divider"></div>
                
                <div className="confirmation-row gas-info">
                  <span className="confirmation-label">Gas Price:</span>
                  <span className="confirmation-value">{transactionDetails.gasPrice}</span>
                </div>
                
                <div className="confirmation-row gas-info">
                  <span className="confirmation-label">Gas Fee:</span>
                  <span className="confirmation-value fee-value">{transactionDetails.gasCost}</span>
                </div>
                
                <div className="confirmation-row gas-info">
                  <span className="confirmation-label">Est. Time:</span>
                  <span className="confirmation-value time-value">{transactionDetails.estimatedTime}</span>
                </div>
                
                <div className="divider"></div>
                
                <div className="confirmation-row total-row">
                  <span className="confirmation-label">Total:</span>
                  <span className="confirmation-value total-value">{transactionDetails.totalCost}</span>
                </div>
              </div>
              
              <div className="confirmation-warning">
                <p>Please verify all details before confirming. Transactions cannot be reversed.</p>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn btn-secondary"
                onClick={() => setShowConfirmation(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={transfer}
              >
                Confirm & Sign
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading indicator for transaction preview */}
      {isLoadingPreview && (
        <div className="modal-overlay">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Preparing transaction...</p>
          </div>
        </div>
      )}
    </Toast.Provider>
  );
};

export default AccountDetails;