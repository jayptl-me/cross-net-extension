import React, { useState, useEffect } from 'react';
import { Account } from '../../interfaces/Account';
import { Chain } from '../../interfaces/Chain';
import { ethers } from 'ethers';
import { testRpcConnection } from '../../wallet-utils/TransactionUtils';

interface TransactionApprovalProps {
  pendingTx: {
    id: string;
    type: 'transaction' | 'sign';
    origin: string;
    transaction: any;
    chainId: string;
  };
  account: Account;
  selectedChain: Chain;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

const TransactionApproval: React.FC<TransactionApprovalProps> = ({
  pendingTx,
  account,
  selectedChain,
  onApprove,
  onReject
}) => {
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [gasPrice, setGasPrice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [formattedValue, setFormattedValue] = useState<string>("0");
  const [txStatus, setTxStatus] = useState<string>("pending"); // Add transaction status state

  // Format origin for display
  const formattedOrigin = pendingTx.origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
  
  // Truncate address for display
  const truncateAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  // Handle transaction approval with status updates
  const handleApprove = async () => {
    try {
      setTxStatus("approving");
      onApprove(pendingTx.id);
    } catch (err: any) {
      console.error("Approval error:", err);
      setError(err.message || "Transaction approval failed");
      setTxStatus("error");
    }
  };

  // Handle transaction rejection
  const handleReject = () => {
    setTxStatus("rejecting");
    onReject(pendingTx.id);
  };

  // Format ETH value
  useEffect(() => {
    if (pendingTx.transaction && pendingTx.transaction.value) {
      try {
        const valueInWei = pendingTx.transaction.value;
        // Convert hex to decimal if it's a hex string
        const valueInEth = ethers.utils.formatEther(
          valueInWei.startsWith('0x') ? valueInWei : `0x${parseInt(valueInWei).toString(16)}`
        );
        setFormattedValue(valueInEth);
      } catch (err) {
        console.error("Error formatting transaction value:", err);
        setFormattedValue("Unknown");
      }
    }
  }, [pendingTx]);

  // Get gas estimates when component mounts
  useEffect(() => {
    const estimateGas = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Check if we can connect to the network first
        const connectionResult = await testRpcConnection(selectedChain.rpcUrl, selectedChain.chainId);
        
        if (connectionResult.status === 'error') {
          throw new Error(`Network connection issue: ${connectionResult.error}`);
        }
        
        // Create a provider
        const provider = new ethers.providers.JsonRpcProvider(selectedChain.rpcUrl);
        
        // Get current gas price
        const currentGasPrice = await provider.getGasPrice();
        setGasPrice(ethers.utils.formatUnits(currentGasPrice, 'gwei'));
        
        // Estimate gas for this transaction
        const tx = {
          to: pendingTx.transaction.to,
          from: pendingTx.transaction.from || account.address,
          value: pendingTx.transaction.value || '0x0',
          data: pendingTx.transaction.data || '0x',
        };
        
        const gasLimit = await provider.estimateGas(tx);
        setGasEstimate(gasLimit.toString());
      } catch (err: any) {
        console.error("Error estimating gas:", err);
        setError(err.message || "Failed to estimate gas for this transaction");
      } finally {
        setIsLoading(false);
      }
    };
    
    estimateGas();
  }, [pendingTx, selectedChain, account.address]);

  // Calculate total transaction cost (value + gas)
  const calculateTotalCost = () => {
    try {
      if (!gasEstimate || !gasPrice) return "Calculating...";
      
      const valueInEth = parseFloat(formattedValue) || 0;
      const gasCost = parseFloat(gasEstimate) * parseFloat(gasPrice) / 1e9; // Convert from gwei to ETH
      const total = valueInEth + gasCost;
      
      return `${total.toFixed(8)} ${selectedChain.nativeCurrency?.symbol || 'ETH'}`;
    } catch {
      return "Unable to calculate";
    }
  };

  return (
    <div className="transaction-approval-container">
      <h2 className="approval-title">
        {pendingTx.type === 'sign' ? 'Sign Transaction' : 'Send Transaction'}
      </h2>
      
      <div className="site-info">
        <div className="site-origin">
          <span className="site-icon">🌐</span>
          <span className="site-domain">{formattedOrigin}</span>
        </div>
      </div>
      
      <div className="transaction-details">
        <div className="detail-row">
          <span className="detail-label">Network:</span>
          <span className="detail-value">{selectedChain.chainName}</span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">From:</span>
          <span className="detail-value address-value">{truncateAddress(account.address)}</span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">To:</span>
          <span className="detail-value address-value">
            {pendingTx.transaction.to ? truncateAddress(pendingTx.transaction.to) : '(Contract Creation)'}
          </span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">Value:</span>
          <span className="detail-value"></span>        </div>
        
        {gasEstimate && (
          <div className="detail-row">
            <span className="detail-label">Gas Limit:</span>
            <span className="detail-value">{gasEstimate}</span>
          </div>
        )}
        
        {gasPrice && (
          <div className="detail-row">
            <span className="detail-label">Gas Price:</span>
            <span className="detail-value">{gasPrice} Gwei</span>
          </div>
        )}
        
        <div className="detail-row total-row">
          <span className="detail-label">Total Cost:</span>
          <span className="detail-value">{calculateTotalCost()}</span>
        </div>
        
        {pendingTx.transaction.data && pendingTx.transaction.data !== '0x' && (
          <div className="detail-row data-row">
            <span className="detail-label">Data:</span>
            <div className="data-container">
              <span className="data-value">{pendingTx.transaction.data.substring(0, 40)}...</span>
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="transaction-error">
          <p className="error-message">{error}</p>
        </div>
      )}
      
      <div className="transaction-warning">
        <p className="warning-text">
          ⚠️ Only approve transactions from sites you trust. This action cannot be undone.
        </p>
      </div>
      
      <div className="approval-actions">
        <button 
          onClick={handleReject}
          className="btn btn-secondary"
        >
          Reject
        </button>
        <button 
          onClick={handleApprove}
          disabled={isLoading || !!error}
          className={`btn btn-primary ${(isLoading || !!error) ? 'btn-disabled' : ''}`}
        >
          {isLoading ? 'Loading...' : 'Approve'}
        </button>
      </div>
    </div>
  );
};

export default TransactionApproval;