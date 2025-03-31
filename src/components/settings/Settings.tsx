import React, { useState } from 'react';
import { Chain } from '../../interfaces/Chain';
import { Account } from '../../interfaces/Account';
import NetworkSettings from './NetworkSettings';
import ConnectedSites from './ConnectedSites';

interface SettingsProps {
  selectedChain: Chain;
  onNetworkChange: (chain: Chain) => void;
  account: Account;
}

const Settings: React.FC<SettingsProps> = ({ 
  selectedChain, 
  onNetworkChange,
  account
}) => {
  const [activeTab, setActiveTab] = useState<'network' | 'connected' | 'security'>('network');
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);
  const [showMnemonic, setShowMnemonic] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  
  // Dummy mnemonic for demo purposes - in a real application, this would be securely stored and retrieved
  const dummyMnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  
  const handleRevealPrivateKey = () => {
    // In a real application, you would verify the password against stored credentials
    if (password === 'password') { // Simple demo password
      setShowPrivateKey(true);
      setPasswordError(null);
    } else {
      setPasswordError('Incorrect password');
    }
  };
  
  const handleRevealMnemonic = () => {
    // In a real application, you would verify the password against stored credentials
    if (password === 'password') { // Simple demo password
      setShowMnemonic(true);
      setPasswordError(null);
    } else {
      setPasswordError('Incorrect password');
    }
  };
  
  const handleCopyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopySuccess(`${type} copied to clipboard!`);
        setTimeout(() => setCopySuccess(null), 3000);
      })
      .catch(err => {
        console.error('Failed to copy: ', err);
      });
  };
  
  const resetDisplay = () => {
    setShowPrivateKey(false);
    setShowMnemonic(false);
    setPassword('');
    setPasswordError(null);
  };

  return (
    <div className="settings-container">
      <h2 className="settings-title">Settings</h2>
      
      <div className="settings-tabs">
        <button 
          className={`settings-tab ${activeTab === 'network' ? 'active' : ''}`}
          onClick={() => setActiveTab('network')}
        >
          Networks
        </button>
        <button 
          className={`settings-tab ${activeTab === 'connected' ? 'active' : ''}`}
          onClick={() => setActiveTab('connected')}
        >
          Connected Sites
        </button>
        <button 
          className={`settings-tab ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          Security
        </button>
      </div>
      
      <div className="settings-content">
        {activeTab === 'network' && (
          <NetworkSettings 
            selectedChain={selectedChain}
            onNetworkChange={onNetworkChange}
          />
        )}
        
        {activeTab === 'connected' && (
          <ConnectedSites
            selectedChain={selectedChain}
          />
        )}
        
        {activeTab === 'security' && (
          <div className="security-settings">
            <h3 className="settings-subtitle">Security Settings</h3>
            
            <div className="security-box">
              <p>Your account address:</p>
              <div className="address-display">
                <p className="wallet-address">{account.address}</p>
                <button 
                  className="btn btn-small btn-copy"
                  onClick={() => handleCopyToClipboard(account.address, 'Address')}
                >
                  Copy
                </button>
              </div>
              
              {!showPrivateKey && !showMnemonic && (
                <div className="security-buttons">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setShowPrivateKey(false);
                      setShowMnemonic(false);
                      document.getElementById('reveal-form')?.classList.remove('hidden');
                    }}
                  >
                    Reveal Private Key
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowPrivateKey(false);
                      setShowMnemonic(false);
                      document.getElementById('reveal-form')?.classList.remove('hidden');
                    }}
                  >
                    Reveal Recovery Phrase
                  </button>
                </div>
              )}
              
              <div id="reveal-form" className={`auth-form ${!showPrivateKey && !showMnemonic && 'hidden'}`}>
                {!showPrivateKey && !showMnemonic && (
                  <>
                    <p>Enter your password to reveal your sensitive information:</p>
                    <div className="form-group">
                      <input 
                        type="password"
                        className="form-input"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    
                    {passwordError && (
                      <div className="auth-error">{passwordError}</div>
                    )}
                    
                    <div className="auth-buttons">
                      <button 
                        className="btn btn-primary"
                        onClick={handleRevealPrivateKey}
                      >
                        Reveal Private Key
                      </button>
                      <button 
                        className="btn btn-secondary"
                        onClick={handleRevealMnemonic}
                      >
                        Reveal Recovery Phrase
                      </button>
                      <button 
                        className="btn btn-outline"
                        onClick={resetDisplay}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
                
                {showPrivateKey && (
                  <div className="revealed-key-container">
                    <h4>Your Private Key:</h4>
                    <div className="private-key-display">
                      {account.privateKey}
                    </div>
                    
                    {copySuccess && (
                      <div className="copy-success-message">
                        {copySuccess}
                      </div>
                    )}
                    
                    <div className="key-buttons">
                      <button 
                        className="btn btn-copy"
                        onClick={() => handleCopyToClipboard(account.privateKey, 'Private key')}
                      >
                        Copy to Clipboard
                      </button>
                      <button 
                        className="btn btn-outline btn-danger"
                        onClick={resetDisplay}
                      >
                        Hide
                      </button>
                    </div>
                    
                    <div className="security-warning">
                      <p>⚠️ Never share your private key with anyone!</p>
                      <p>Anyone with your private key has complete control over your account.</p>
                    </div>
                  </div>
                )}
                
                {showMnemonic && (
                  <div className="revealed-key-container">
                    <h4>Your Recovery Phrase:</h4>
                    <div className="mnemonic-word-list">
                      {dummyMnemonic.split(' ').map((word, index) => (
                        <div key={index} className="mnemonic-word">
                          <span className="word-number">{index + 1}.</span> {word}
                        </div>
                      ))}
                    </div>
                    
                    {copySuccess && (
                      <div className="copy-success-message">
                        {copySuccess}
                      </div>
                    )}
                    
                    <div className="key-buttons">
                      <button 
                        className="btn btn-copy"
                        onClick={() => handleCopyToClipboard(dummyMnemonic, 'Recovery phrase')}
                      >
                        Copy to Clipboard
                      </button>
                      <button 
                        className="btn btn-outline btn-danger"
                        onClick={resetDisplay}
                      >
                        Hide
                      </button>
                    </div>
                    
                    <div className="security-warning">
                      <p>⚠️ Keep your recovery phrase safe!</p>
                      <p>Anyone with your recovery phrase can restore your wallet and access your funds.</p>
                      <p>Store it in a secure location and never share it with anyone.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;