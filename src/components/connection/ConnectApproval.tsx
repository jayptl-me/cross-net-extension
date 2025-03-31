import React, { useState } from 'react';
import { Account } from '../../interfaces/Account';

interface ConnectApprovalProps {
  origin: string;
  account: Account;
  chainName: string;
  onApprove: () => void;
  onReject: () => void;
}

const ConnectApproval: React.FC<ConnectApprovalProps> = ({
  origin,
  account,
  chainName,
  onApprove,
  onReject
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'approving' | 'rejecting'>('idle');
  
  // Format origin for display
  const formattedOrigin = origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
  
  // Display only part of the address for security
  const truncatedAddress = account ? 
    `${account.address.substring(0, 6)}...${account.address.substring(account.address.length - 4)}`
    : 'Unknown Account';
  
  // Handle approve with confirmation
  const handleApprove = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    
    setIsProcessing(true);
    setStatus('approving');
    console.log('Approving connection request for:', formattedOrigin);
    
    // Add small delay to ensure UI updates before potentially closing
    setTimeout(() => {
      onApprove();
    }, 50);
  };
  
  // Handle reject with confirmation
  const handleReject = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    
    setIsProcessing(true);
    setStatus('rejecting');
    console.log('Rejecting connection request for:', formattedOrigin);
    
    // Add small delay to ensure UI updates before potentially closing
    setTimeout(() => {
      onReject();
    }, 50);
  };
  
  return (
    <div className="wallet-container">
      <div className="connect-approval-container">
        <h2 className="connect-title">Connection Request</h2>
        
        <div className="site-info">
          <div className="site-origin">
            <span className="site-icon">🌐</span>
            <span className="site-domain">{formattedOrigin}</span>
          </div>
          
          <p className="connect-message">
            This site is requesting to connect to your wallet
          </p>
        </div>
        
        <div className="connection-details">
          <div className="detail-item">
            <span className="detail-label">Network:</span>
            <span className="detail-value network-value">{chainName}</span>
          </div>
          
          <div className="detail-item">
            <span className="detail-label">Account:</span>
            <span className="detail-value address-value">{truncatedAddress}</span>
          </div>
        </div>
        
        <div className="connect-warning">
          <p className="warning-title">⚠️ Only connect to trusted sites</p>
          <p className="warning-text">
            This site will be able to:
          </p>
          <ul className="warning-list">
            <li>See your wallet address</li>
            <li>Request network changes</li>
            <li>Request transaction approvals</li>
          </ul>
          <p className="warning-text">
            It will NOT have access to your private keys or funds without your approval.
          </p>
        </div>
        
        <div className="approval-actions">
          <button 
            onClick={handleReject}
            className="btn btn-secondary"
            type="button"
          >
            Reject
          </button>
          <button 
            onClick={handleApprove}
            className="btn btn-primary"
            type="button"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectApproval;