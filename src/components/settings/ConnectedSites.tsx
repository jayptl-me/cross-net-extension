import React, { useState, useEffect } from 'react';
import { Chain } from '../../interfaces/Chain';

interface ConnectedSite {
  origin: string;
  connected: boolean;
  accounts: string[];
  chainId: string;
  permissions: string[];
  timestamp: number;
}

interface ConnectedSitesProps {
  selectedChain: Chain;
}

const ConnectedSites: React.FC<ConnectedSitesProps> = ({ selectedChain }) => {
  const [connectedSites, setConnectedSites] = useState<Record<string, ConnectedSite>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // Load connected sites from storage
  useEffect(() => {
    const loadConnectedSites = async () => {
      try {
        setLoading(true);
        
        // Check if we're in extension context
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get(['connectedSites'], (result) => {
            if (result.connectedSites) {
              setConnectedSites(result.connectedSites);
            }
            setLoading(false);
          });
        } else {
          // Web app context (use localStorage as fallback)
          const storedSites = localStorage.getItem('connectedSites');
          if (storedSites) {
            setConnectedSites(JSON.parse(storedSites));
          }
          setLoading(false);
        }
      } catch (error) {
        console.error('Error loading connected sites:', error);
        setLoading(false);
      }
    };
    
    loadConnectedSites();
  }, []);

  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  // Format domain from origin
  const formatDomain = (origin: string) => {
    return origin.replace(/^https?:\/\//, '').replace(/\/$/, '');
  };

  // Disconnect a site
  const handleDisconnect = (origin: string) => {
    // Update the site's connected status
    const updatedSites = { ...connectedSites };
    updatedSites[origin] = {
      ...updatedSites[origin],
      connected: false
    };
    
    // Save to storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ connectedSites: updatedSites }, () => {
        setConnectedSites(updatedSites);
        
        // Notify the background script
        chrome.runtime.sendMessage({
          type: 'SITE_DISCONNECTED',
          origin
        });
      });
    } else {
      // Web app context
      localStorage.setItem('connectedSites', JSON.stringify(updatedSites));
      setConnectedSites(updatedSites);
    }
  };

  // Filter to show only connected sites
  const getConnectedSitesList = () => {
    return Object.entries(connectedSites)
      .filter(([_, site]) => site.connected)
      .sort((a, b) => b[1].timestamp - a[1].timestamp);
  };

  const connectedSitesList = getConnectedSitesList();

  return (
    <div className="connected-sites-container">
      <h3 className="settings-subtitle">Connected Sites</h3>
      
      {loading ? (
        <div className="loading-message">Loading connected sites...</div>
      ) : connectedSitesList.length === 0 ? (
        <div className="no-connected-sites">
          <p>No sites are currently connected to your wallet.</p>
        </div>
      ) : (
        <div className="sites-list">
          {connectedSitesList.map(([origin, site]) => (
            <div key={origin} className="site-item">
              <div className="site-info">
                <div className="site-domain">{formatDomain(origin)}</div>
                <div className="site-details">
                  <span className="site-connected-at">
                    Connected: {formatDate(site.timestamp)}
                  </span>
                </div>
              </div>
              
              <div className="site-actions">
                <button 
                  onClick={() => handleDisconnect(origin)}
                  className="btn btn-small btn-outline btn-danger"
                  title="Disconnect this site"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ConnectedSites;