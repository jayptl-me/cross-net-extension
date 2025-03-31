// Chain configuration interface for different blockchain networks
export interface Chain {
  [x: string]: any;
  nativeCurrency: any;
  chainId: string;
  chainName: string;
  rpcUrl: string;
  currencySymbol: string;
  blockExplorerUrl: string;
  // Added isCustom flag to identify user-added networks
  isCustom?: boolean;
  // Adding optional fallback RPC URLs for better reliability
  fallbackRpcUrls?: string[];
}

// Mumbai testnet configuration
export const amoy: Chain = {
  chainId: "80002",
  chainName: "Polygon Amoy",
  rpcUrl: "https://rpc-amoy.polygon.technology",
  currencySymbol: "MATIC",
  blockExplorerUrl: "https://amoy.polygonscan.com",
  fallbackRpcUrls: [
    "https://polygon-amoy.blockpi.network/v1/rpc/public",
    "https://amoy.polygon.rpc.thirdweb.com"
  ],
  nativeCurrency: undefined
};

// Ethereum Sepolia testnet
export const sepolia: Chain = {
  chainId: "11155111",
  chainName: "Ethereum Sepolia",
  rpcUrl: "https://rpc.sepolia.org",
  currencySymbol: "ETH",
  blockExplorerUrl: "https://sepolia.etherscan.io",
  fallbackRpcUrls: [
    "https://ethereum-sepolia.blockpi.network/v1/rpc/public",
    "https://rpc2.sepolia.org"
  ],
  nativeCurrency: undefined
};

// Polygon Mainnet configuration
export const polygon: Chain = {
  chainId: "137",
  chainName: "Polygon Mainnet",
  rpcUrl: "https://polygon.llamarpc.com",
  currencySymbol: "MATIC", // Fixed currency symbol
  blockExplorerUrl: "https://polygonscan.com",
  fallbackRpcUrls: [
    "https://polygon-rpc.com",
    "https://rpc-mainnet.matic.network"
  ],
  nativeCurrency: undefined
};

// Ethereum Mainnet configuration
export const ethereum: Chain = {
  chainId: "1",
  chainName: "Ethereum Mainnet",
  rpcUrl: "https://eth.llamarpc.com",
  currencySymbol: "ETH",
  blockExplorerUrl: "https://etherscan.io",
  fallbackRpcUrls: [
    "https://ethereum.publicnode.com",
    "https://rpc.ankr.com/eth"
  ],
  nativeCurrency: undefined
};

// Chain configuration object for easy lookup by chainId
export const CHAINS_CONFIG: { [key: string]: Chain } = {
  "80002": amoy,
  "11155111": sepolia,
  "137": polygon,
  "1": ethereum,
  // Add more chains as needed
};

// Function to save custom networks to localStorage
export const saveCustomNetworks = (networks: Chain[]) => {
  localStorage.setItem('custom-networks', JSON.stringify(networks));
};

// Function to get custom networks from localStorage
export const getCustomNetworks = (): Chain[] => {
  const networks = localStorage.getItem('custom-networks');
  return networks ? JSON.parse(networks) : [];
};

// Function to add custom networks to the configuration
export const addCustomNetwork = (network: Chain) => {
  // Mark as custom
  network.isCustom = true;
  
  // Add to CHAINS_CONFIG
  CHAINS_CONFIG[network.chainId] = network;
  
  // Save to localStorage
  const networks = getCustomNetworks();
  networks.push(network);
  saveCustomNetworks(networks);
  
  return network;
};