import React, { useState, useEffect } from 'react';
import { Chain, ethereum, polygon, amoy, sepolia } from '../../interfaces/Chain';
import { testRpcConnection } from '../../wallet-utils/TransactionUtils';

// Import blockchain logos
import ethereumLogo from '../../assets/images/ethereum-logo.svg';
import polygonLogo from '../../assets/images/polygon-logo.svg';
import sepoliaLogo from '../../assets/images/sepolia-logo.svg';
import amoyLogo from '../../assets/images/amoy-logo.svg';

interface NetworkSettingsProps {
  selectedChain: Chain;
  onNetworkChange: (chain: Chain) => void;
}

const NetworkSettings: React.FC<NetworkSettingsProps> = ({ 
  selectedChain,
  onNetworkChange
}) => {
  const [isExtension, setIsExtension] = useState<boolean>(false);
  const [customRpcUrl, setCustomRpcUrl] = useState<string>('');
  const [customChainId, setCustomChainId] = useState<string>('');
  const [customChainName, setCustomChainName] = useState<string>('');
  const [customCurrencySymbol, setCustomCurrencySymbol] = useState<string>('');
  const [showAddCustom, setShowAddCustom] = useState<boolean>(false);
  const [customNetworks, setCustomNetworks] = useState<Chain[]>([]);
  
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error' | 'checking'>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // List of all available chains with their logos
  const networks = [
    { ...ethereum, logo: ethereumLogo },
    { ...polygon, logo: polygonLogo },
    { ...sepolia, logo: sepoliaLogo },
    { ...amoy, logo: amoyLogo }
  ];

  // Check if running as extension
  useEffect(() => {
    setIsExtension(typeof window.chrome !== 'undefined' && window.chrome.runtime && !!window.chrome.runtime.id);
  }, []);

  // Load custom networks from storage
  useEffect(() => {
    loadCustomNetworks();
  }, []);

  // Load custom networks from localStorage or chrome.storage if in extension mode
  const loadCustomNetworks = () => {
    if (isExtension) {
      chrome.storage.local.get(['customNetworks'], (result) => {
        if (result.customNetworks) {
          setCustomNetworks(JSON.parse(result.customNetworks));
        }
      });
    } else {
      const storedNetworks = localStorage.getItem('customNetworks');
      if (storedNetworks) {
        try {
          setCustomNetworks(JSON.parse(storedNetworks));
        } catch (error) {
          console.error('Failed to parse custom networks:', error);
        }
      }
    }
  };

  // Check network connection status
  useEffect(() => {
    testNetworkConnection();
  }, [selectedChain]);

  // Test connection to the current network
  const testNetworkConnection = async () => {
    setConnectionStatus('checking');
    setErrorMessage(null);
    
    try {
      const { status, error } = await testRpcConnection(selectedChain.rpcUrl);
      
      if (status === 'success') {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
        setErrorMessage(`RPC Error: ${error}`);
      }
    } catch (error: any) {
      setConnectionStatus('error');
      setErrorMessage(`Connection failed: ${error.message}`);
    }
  };

  // Handle network change
  const handleNetworkChange = (chain: Chain) => {
    // Update state
    onNetworkChange(chain);
    
    // If we're in extension mode, notify connected sites about the chain change
    if (isExtension) {
      window.chrome.runtime.sendMessage({
        type: 'CHAIN_CHANGED',
        chainId: chain.chainId
      });
    }
  };

  // Save custom networks to storage
  const saveCustomNetworks = (networks: Chain[]) => {
    const networksJson = JSON.stringify(networks);
    
    if (isExtension) {
      chrome.storage.local.set({ customNetworks: networksJson }, () => {
        console.log('Custom networks saved to extension storage');
      });
    } else {
      localStorage.setItem('customNetworks', networksJson);
    }
  };

  // Toggle add custom network form
  const toggleAddCustomNetwork = () => {
    setShowAddCustom(!showAddCustom);
    
    // Clear form when hiding
    if (showAddCustom) {
      setCustomRpcUrl('');
      setCustomChainId('');
      setCustomChainName('');
      setCustomCurrencySymbol('');
    }
  };

  // Add custom network
  const handleAddCustomNetwork = () => {
    // Basic validation
    if (!customRpcUrl || !customChainId || !customChainName || !customCurrencySymbol) {
      setErrorMessage('All fields are required');
      return;
    }
    
    try {
      // Create new chain object
      const newChain: Chain = {
        chainId: customChainId,
        chainName: customChainName,
        rpcUrl: customRpcUrl,
        currencySymbol: customCurrencySymbol,
        blockExplorerUrl: '',
        nativeCurrency: undefined
      };
      
      // Check if network with same chainId already exists
      const existingIndex = customNetworks.findIndex((n: Chain) => n.chainId === customChainId);
      let updatedNetworks: Chain[];
      
      if (existingIndex >= 0) {
        updatedNetworks = [...customNetworks];
        updatedNetworks[existingIndex] = newChain;
      } else {
        updatedNetworks = [...customNetworks, newChain];
      }
      
      // Update state
      setCustomNetworks(updatedNetworks);
      
      // Save to storage
      saveCustomNetworks(updatedNetworks);
      
      // Switch to the new network
      handleNetworkChange(newChain);
      
      // Reset form
      setCustomRpcUrl('');
      setCustomChainId('');
      setCustomChainName('');
      setCustomCurrencySymbol('');
      setShowAddCustom(false);
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  // Remove custom network
  const handleRemoveCustomNetwork = (chainId: string) => {
    const updatedNetworks = customNetworks.filter(network => network.chainId !== chainId);
    setCustomNetworks(updatedNetworks);
    saveCustomNetworks(updatedNetworks);
    
    // If the selected chain was removed, switch to Ethereum
    if (selectedChain.chainId === chainId) {
      handleNetworkChange(ethereum);
    }
  };

  // Get logo for selected chain
  const getSelectedChainLogo = () => {
    const network = networks.find(net => net.chainId === selectedChain.chainId);
    return network?.logo || null;
  };

  return (
    <div className="network-settings">
      <h3 className="settings-subtitle">Network Settings</h3>
      
      <div className="network-status-indicator">
        <span className="status-label">Current Network:</span>
        {getSelectedChainLogo() && (
          <img 
            src={getSelectedChainLogo() ?? undefined} 
            alt={`${selectedChain.chainName} logo`} 
            className="network-status-logo" 
          />
        )}
        <span className={`status-value status-${connectionStatus}`}>
          {selectedChain.chainName}
        </span>
        <button 
          onClick={testNetworkConnection} 
          className="btn btn-small" 
          disabled={connectionStatus === 'checking'}
        >
          {connectionStatus === 'checking' ? 'Testing...' : 'Test'}
        </button>
      </div>
      
      {errorMessage && (
        <div className="error-message">
          {errorMessage}
        </div>
      )}
      
      <div className="network-selection-container">
        <h4 className="settings-subtitle">Select Network</h4>
        
        <div className="network-grid">
          {/* Built-in networks */}
          {networks.map((network) => (
            <div 
              key={network.chainId} 
              className={`network-card ${selectedChain.chainId === network.chainId ? 'selected' : ''}`}
              onClick={() => handleNetworkChange(network)}
            >
              <div className="network-icon">
                {network.logo ? (
                  <img 
                    src={network.logo} 
                    alt={`${network.chainName} logo`} 
                    className="network-logo" 
                  />
                ) : (
                  <div className="network-fallback-icon">
                    {network.chainName.substring(0, 1)}
                  </div>
                )}
              </div>
              <div className="network-info">
                <div className="network-name">{network.chainName}</div>
                <div className="network-id">Chain ID: {network.chainId}</div>
              </div>
              {selectedChain.chainId === network.chainId && (
                <div className="selected-indicator">✓</div>
              )}
            </div>
          ))}
          
          {/* Custom networks */}
          {customNetworks.map((network) => (
            <div 
              key={network.chainId} 
              className={`network-card custom-network ${selectedChain.chainId === network.chainId ? 'selected' : ''}`}
              onClick={() => handleNetworkChange(network)}
            >
              <div className="network-icon">
                <div className="network-fallback-icon custom">
                  {network.chainName.substring(0, 1)}
                </div>
              </div>
              <div className="network-info">
                <div className="network-name">{network.chainName}</div>
                <div className="network-id">Chain ID: {network.chainId}</div>
              </div>
              {selectedChain.chainId === network.chainId && (
                <div className="selected-indicator">✓</div>
              )}
              <button 
                className="remove-network-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveCustomNetwork(network.chainId);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        
        <div className="add-custom-network">
          <button 
            onClick={toggleAddCustomNetwork}
            className="btn btn-outline btn-primary"
          >
            {showAddCustom ? 'Cancel' : '+ Add Custom Network'}
          </button>
        </div>
        
        {showAddCustom && (
          <div className="custom-network-form">
            <div className="form-group">
              <label className="form-label">Network Name</label>
              <input
                type="text"
                value={customChainName}
                onChange={(e) => setCustomChainName(e.target.value)}
                placeholder="e.g. My Custom Network"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">RPC URL</label>
              <input
                type="text"
                value={customRpcUrl}
                onChange={(e) => setCustomRpcUrl(e.target.value)}
                placeholder="e.g. https://my-network.rpc"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Chain ID</label>
              <input
                type="text"
                value={customChainId}
                onChange={(e) => setCustomChainId(e.target.value)}
                placeholder="e.g. 1, 137, etc."
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Currency Symbol</label>
              <input
                type="text"
                value={customCurrencySymbol}
                onChange={(e) => setCustomCurrencySymbol(e.target.value)}
                placeholder="e.g. ETH, MATIC"
                className="form-input"
              />
            </div>
            
            <button 
              onClick={handleAddCustomNetwork}
              className="btn btn-primary"
            >
              Add Network
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkSettings;