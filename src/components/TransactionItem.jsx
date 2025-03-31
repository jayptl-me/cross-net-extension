import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { shortenAddress } from '../utils/helpers';

const TransactionItem = ({ transaction }) => {
  const { 
    hash, 
    from, 
    to, 
    value, 
    timestamp, 
    blockNumber, 
    isIncoming 
  } = transaction;
  
  const formattedDate = timestamp 
    ? formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true }) 
    : 'Unknown time';
  
  const explorerUrl = `https://etherscan.io/tx/${hash}`;
  const typeClass = isIncoming ? 'received' : 'sent';
  const amountClass = isIncoming ? 'received-amount' : 'sent-amount';
  
  return (
    <div className={`transaction-item ${typeClass}`}>
      <div className="transaction-header">
        <div className="transaction-type-container">
          <span className={`transaction-type ${typeClass}`}>
            {isIncoming ? 'Received' : 'Sent'}
          </span>
          <span className="transaction-asset">ETH</span>
        </div>
        <span className="transaction-date">{formattedDate}</span>
      </div>
      
      <div className="transaction-details">
        <div className="transaction-amount-container">
          <span className="transaction-amount-label">Amount</span>
          <span className={`transaction-amount ${amountClass}`}>
            {isIncoming ? '+' : '-'}{value} ETH
          </span>
        </div>
        
        {from && (
          <div className="transaction-address-container">
            <span className="transaction-address-label">From</span>
            <span className="transaction-address">{shortenAddress(from)}</span>
          </div>
        )}
        
        {to && (
          <div className="transaction-address-container">
            <span className="transaction-address-label">To</span>
            <span className="transaction-address">{shortenAddress(to)}</span>
          </div>
        )}
        
        {blockNumber && (
          <div className="transaction-address-container">
            <span className="transaction-address-label">Block</span>
            <span className="transaction-block">#{blockNumber}</span>
          </div>
        )}
      </div>
      
      <div className="transaction-actions">
        <a 
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transaction-view-link"
        >
          View details
        </a>
      </div>
    </div>
  );
};

export default TransactionItem;