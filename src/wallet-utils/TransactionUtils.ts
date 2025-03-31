// Transaction utility functions for sending ETH and interacting with the blockchain
import { ethers, Wallet, utils } from "ethers";
import { CHAINS_CONFIG, amoy, Chain } from "../interfaces/Chain";

// Network connection timeouts and retry configuration
const CONNECTION_TIMEOUT_MS = 15000;  // 15 second timeout for network connections
const TRANSACTION_TIMEOUT_MS = 45000; // 45 second timeout for transactions
const MAX_CONNECTION_RETRIES = 3;     // Number of times to retry connecting to network

// Helper function to test and cache working providers
const providerCache: Record<string, {provider: ethers.providers.JsonRpcProvider, timestamp: number}> = {};
const CACHE_EXPIRY_MS = 60000; // 1 minute cache expiry

// Helper function to try connecting to different RPC URLs with enhanced reliability
async function getWorkingProvider(chain: Chain): Promise<ethers.providers.JsonRpcProvider> {
  // Check cache first to avoid unnecessary network calls
  const cacheKey = chain.chainId;
  const cached = providerCache[cacheKey];
  if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY_MS)) {
    try {
      // Verify the cached provider is still responsive
      await Promise.race([
        cached.provider.getNetwork(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Cached provider timeout")), 3000))
      ]);
      console.log(`Using cached provider for ${chain.chainName}`);
      return cached.provider;
    } catch (error) {
      console.log(`Cached provider for ${chain.chainName} is no longer responsive, getting new provider...`);
      // Cache is stale or provider unresponsive, continue to get new provider
    }
  }

  // Helper function to try a single RPC URL with proper error handling
  const tryProvider = async (url: string): Promise<ethers.providers.JsonRpcProvider | null> => {
    let retryCount = 0;
    
    while (retryCount < MAX_CONNECTION_RETRIES) {
      try {
        console.log(`Attempting to connect to RPC: ${url} (attempt ${retryCount + 1}/${MAX_CONNECTION_RETRIES})`);
        const provider = new ethers.providers.JsonRpcProvider(url);
        
        // Add a timeout to the network check
        await Promise.race([
          provider.getNetwork(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Connection to ${url} timed out`)), CONNECTION_TIMEOUT_MS)
          )
        ]);
        
        // Verify we can get the block number (additional check)
        await provider.getBlockNumber();
        
        console.log(`Successfully connected to ${chain.chainName} via ${url}`);
        
        // Cache this working provider
        providerCache[cacheKey] = {
          provider,
          timestamp: Date.now()
        };
        
        return provider;
      } catch (error: any) {
        retryCount++;
        console.log(`RPC ${url} attempt ${retryCount} failed: ${error.message || 'Unknown error'}`);
        
        if (retryCount < MAX_CONNECTION_RETRIES) {
          // Exponential backoff between retries
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.log(`Waiting ${backoffTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }
    
    // All retries failed for this URL
    return null;
  };
  
  // Try primary RPC first
  const primaryProvider = await tryProvider(chain.rpcUrl);
  if (primaryProvider) return primaryProvider;
  
  // Try fallback URLs if available
  if (chain.fallbackRpcUrls && chain.fallbackRpcUrls.length > 0) {
    for (const fallbackUrl of chain.fallbackRpcUrls) {
      const fallbackProvider = await tryProvider(fallbackUrl);
      if (fallbackProvider) return fallbackProvider;
    }
  }
  
  // Public fallback RPCs as a last resort based on chainId
  const emergencyFallbacks: Record<string, string[]> = {
    "1": [
      "https://rpc.ankr.com/eth", 
      "https://ethereum.publicnode.com",
      "https://eth.llamarpc.com"
    ],
    "137": [
      "https://polygon-rpc.com", 
      "https://polygon-mainnet.public.blastapi.io",
      "https://polygon.llamarpc.com"
    ],
    "80002": [
      "https://rpc-amoy.polygon.technology",
      "https://polygon-amoy.blockpi.network/v1/rpc/public"
    ],
    "11155111": [
      "https://ethereum-sepolia.blockpi.network/v1/rpc/public",
      "https://rpc2.sepolia.org",
      "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161" // Public Infura endpoint
    ]
  };
  
  // Try emergency fallbacks if available for this chain
  if (emergencyFallbacks[chain.chainId]) {
    console.log("Trying emergency fallback RPC endpoints...");
    for (const emergencyUrl of emergencyFallbacks[chain.chainId]) {
      if (emergencyUrl !== chain.rpcUrl && !chain.fallbackRpcUrls?.includes(emergencyUrl)) {
        const emergencyProvider = await tryProvider(emergencyUrl);
        if (emergencyProvider) return emergencyProvider;
      }
    }
  }

  // If we get here, throw a more descriptive error as all RPCs failed
  throw new Error(`Could not detect network: Failed to connect to ${chain.chainName}. All RPC endpoints are unavailable. Please check your internet connection or try a different network.`);
}

// Helper function to validate transaction response
function validateTransactionResponse(transaction: any): boolean {
  if (!transaction) return false;
  
  // Check for both hash and other essential properties
  const hasRequiredProps = transaction.hash && 
                           transaction.nonce !== undefined && 
                           transaction.gasLimit !== undefined;
  
  // Also check that properties are not empty/null
  const hasValidValues = transaction.hash.length > 0;
  
  return hasRequiredProps && hasValidValues;
}

// Helper function for transaction attempts with retry logic
async function attemptTransaction(
  wallet: Wallet,
  tx: ethers.providers.TransactionRequest,
  chain: Chain,
  provider: ethers.providers.JsonRpcProvider,
  retryCount: number,
  maxRetries: number,
  lastAttemptedNonce: number | null,
  privateKey: string
): Promise<ethers.providers.TransactionResponse> {
  try {
    // Send the transaction with a timeout
    const transactionPromise = wallet.sendTransaction(tx);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Transaction request timed out")), TRANSACTION_TIMEOUT_MS)
    );
    
    // Race the transaction against the timeout
    const transaction = await Promise.race([
      transactionPromise,
      timeoutPromise
    ]) as ethers.providers.TransactionResponse;
    
    if (!validateTransactionResponse(transaction)) {
      throw new Error("Missing or invalid transaction response");
    }
    
    return transaction;
  } catch (error: any) {
    // Check if we should retry
    if (retryCount < maxRetries) {
      retryCount++;
      console.log(`Transaction attempt ${retryCount} failed, retrying...`);
      
      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // If provider issue, try to get a new provider
      if (error.message.includes("missing response") || 
          error.message.includes("invalid response") ||
          error.message.includes("timed out")) {
        console.log("Provider issue detected, getting new provider...");
        const newProvider = await getWorkingProvider(chain);
        const newWallet = new Wallet(privateKey, newProvider);
        
        // Check if the previous transaction might have gone through
        try {
          // See if our nonce has changed, which would indicate the transaction was successful
          const currentNonce = await newProvider.getTransactionCount(wallet.address, "latest");
          if (currentNonce > lastAttemptedNonce!) {
            console.log("Transaction may have succeeded despite the error. Current nonce is higher than attempted nonce.");
            
            // Try to find the transaction by nonce
            const pendingBlock = await newProvider.getBlockWithTransactions("latest");
            const matchingTx = pendingBlock.transactions.find(
              tx => tx.from.toLowerCase() === wallet.address.toLowerCase() && 
                    tx.nonce === lastAttemptedNonce
            );
            
            if (matchingTx) {
              console.log("Found the transaction in the pending block:", matchingTx.hash);
              return matchingTx;
            }
            
            // Create a placeholder transaction response with custom property
            const placeholderTx = {
              hash: "0x0000000000000000000000000000000000000000000000000000000000000000", // Placeholder hash
              confirmations: 0,
              from: wallet.address,
              wait: async () => { throw new Error("Cannot wait for a reconstructed transaction"); },
              nonce: lastAttemptedNonce!,
              gasLimit: tx.gasLimit,
              gasPrice: tx.gasPrice,
              data: "0x",
              value: tx.value,
              chainId: (await newProvider.getNetwork()).chainId,
              to: tx.to
            } as ethers.providers.TransactionResponse & { possiblySucceeded?: boolean };
            
            // Add custom property
            placeholderTx.possiblySucceeded = true;
            
            return placeholderTx;
          }
        } catch (checkError) {
          console.error("Error checking if transaction succeeded:", checkError);
        }
      }
      
      // Retry transaction
      return attemptTransaction(wallet, tx, chain, provider, retryCount, maxRetries, lastAttemptedNonce, privateKey);
    } else {
      // Check if the transaction might have gone through despite errors
      try {
        if (provider) {
          const currentNonce = await provider.getTransactionCount(wallet.address, "latest");
          if (currentNonce > lastAttemptedNonce!) {
            console.log("Transaction may have succeeded despite maximum retries. Current nonce is higher than attempted nonce.");
            
            // Return a placeholder success response with custom property
            const placeholderTx = {
              hash: "0x0000000000000000000000000000000000000000000000000000000000000000", // Placeholder hash
              confirmations: 0,
              from: wallet.address,
              wait: async () => { throw new Error("Cannot wait for a reconstructed transaction"); },
              nonce: lastAttemptedNonce!,
              gasLimit: tx.gasLimit,
              gasPrice: tx.gasPrice,
              data: "0x",
              value: tx.value,
              chainId: (await provider.getNetwork()).chainId,
              to: tx.to
            } as ethers.providers.TransactionResponse & { possiblySucceeded?: boolean };
            
            // Add custom property
            placeholderTx.possiblySucceeded = true;
            
            return placeholderTx;
          }
        }
      } catch (finalCheckError) {
        console.error("Final error check failed:", finalCheckError);
      }
      
      // Max retries exceeded
      throw error;
    }
  }
}

export async function sendToken(
  amount: number,
  from: string,
  to: string,
  privateKey: string,
  chainId: string = amoy.chainId  // default to Amoy network
) {
  let provider: ethers.providers.JsonRpcProvider | null = null;
  let retryCount = 0;
  const maxRetries = 2;
  let lastAttemptedNonce: number | null = null;
  
  try {
    // Validate destination address
    if (!utils.isAddress(to)) {
      throw new Error("Invalid destination address format");
    }

    // Use the chain config based on the chainId
    const chain = CHAINS_CONFIG[chainId] || amoy;
    
    // Get a working provider with automatic fallback
    provider = await getWorkingProvider(chain);
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name} (${network.chainId})`);
    
    const wallet: Wallet = new Wallet(privateKey, provider);
    
    // Check if wallet has enough balance for the transaction
    const balance = await provider.getBalance(wallet.address);
    const amountWei = utils.parseEther(amount.toString());
    
    if (balance.lt(amountWei)) {
      throw new Error(`Insufficient balance: You have ${utils.formatEther(balance)} ${chain.currencySymbol}, but tried to send ${amount} ${chain.currencySymbol}`);
    }

    // Get current gas price and estimate gas limit
    const gasPrice = await provider.getGasPrice();
    
    // Calculate gas cost (approximate)
    const gasLimit = 21000; // Standard gas limit for ETH transfers
    const gasCost = gasPrice.mul(gasLimit);
    
    // Check if wallet has enough for gas + amount
    if (balance.lt(amountWei.add(gasCost))) {
      const totalNeeded = utils.formatEther(amountWei.add(gasCost));
      throw new Error(`Insufficient balance for gas: You need approximately ${totalNeeded} ${chain.currencySymbol} (including gas) but have ${utils.formatEther(balance)} ${chain.currencySymbol}`);
    }

    // Create the transaction object with proper gas settings
    const nonce = await provider.getTransactionCount(wallet.address, "latest");
    lastAttemptedNonce = nonce;
    
    const tx = {
      to,
      value: amountWei,
      gasPrice,
      gasLimit,
      nonce
    };

    console.log(`Sending transaction: ${amount} ${chain.currencySymbol} to ${to}`);
    
    // Attempt to send transaction with retry logic
    const transaction = await attemptTransaction(wallet, tx, chain, provider, retryCount, maxRetries, lastAttemptedNonce, privateKey);
    console.log(`Transaction sent: ${transaction.hash}`);
    
    // Type assertion for the custom property
    const txWithCustomProps = transaction as ethers.providers.TransactionResponse & { possiblySucceeded?: boolean };
    
    // If this is a placeholder transaction that might have succeeded
    if (txWithCustomProps.possiblySucceeded) {
      return {
        transaction,
        receipt: null,
        pending: true,
        possiblySucceeded: true,
        message: "Transaction might have succeeded, but we couldn't get a confirmation. Please check your wallet balance and the blockchain explorer."
      };
    }
    
    // Wait for confirmation with a more robust approach and error handling
    try {
      const receipt = await transaction.wait(1); // Wait for 1 confirmation
      
      if (!receipt) {
        throw new Error("No receipt received after transaction");
      }
      
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      return { transaction, receipt };
    } catch (waitError: any) {
      // Handle specific wait errors
      if (waitError.code === 'TIMEOUT') {
        console.log("Transaction was submitted but confirmation timed out. Check explorer with hash:", transaction.hash);
        return { 
          transaction, 
          receipt: null, 
          pending: true,
          message: `Transaction submitted (hash: ${transaction.hash}) but confirmation timed out. You can check the status on the block explorer.`
        };
      }
      
      // Handle missing response during confirmation
      if (waitError.message.includes("missing response") || 
          waitError.message.includes("invalid response") ||
          waitError.message.includes("network error")) {
        console.log("Network issue while waiting for confirmation. Transaction may still be processing. Hash:", transaction.hash);
        return { 
          transaction, 
          receipt: null, 
          pending: true, 
          message: `Transaction was submitted (hash: ${transaction.hash}) but network issues prevented confirmation. You can check the status on the block explorer.`
        };
      }
      
      // Rethrow the error to be caught by the outer catch block
      throw waitError;
    }
  } catch (error: any) {
    // Special handling for missing response errors
    if (error.message.includes("missing response")) {
      console.error("Transaction failed with missing response error. This usually means the RPC endpoint did not respond properly.");
      
      // Check if the transaction might have gone through despite errors
      if (provider && lastAttemptedNonce !== null) {
        try {
          const currentNonce = await provider.getTransactionCount(from, "latest");
          if (currentNonce > lastAttemptedNonce) {
            console.log("Transaction may have succeeded despite the error. Current nonce is higher than attempted nonce.");
            return {
              transaction: {
                hash: "0x0000000000000000000000000000000000000000000000000000000000000000", // Placeholder hash
                from,
                to,
                value: amount,
                possiblySucceeded: true
              },
              receipt: null,
              pending: true,
              possiblySucceeded: true,
              message: "Transaction might have succeeded, but we couldn't get a confirmation due to network issues. Please check your wallet balance and the blockchain explorer."
            };
          }
        } catch (nonceCheckError) {
          console.error("Error checking nonce after missing response:", nonceCheckError);
        }
      }
      
      throw new Error("Transaction failed: The network did not respond. Your transaction might still be processing. Please check the block explorer or try again.");
    }
    
    // Format error message for better user experience
    console.error("Transaction error:", error);
    const errorMessage = error.reason || error.message || JSON.stringify(error);
    throw new Error(`Transaction failed: ${errorMessage}`);
  }
}

// Get balance for an address on specified network
export async function getBalance(
  address: string, 
  chain: Chain
): Promise<string> {
  try {
    // Get a working provider with automatic fallback
    const provider = await getWorkingProvider(chain);
    const balance = await provider.getBalance(address);
    return ethers.utils.formatEther(balance);
  } catch (error) {
    console.error("Error fetching balance:", error);
    return "0";
  }
}

// Helper function to test RPC connection with better error handling
export async function testRpcConnection(rpcUrl: string, chainId?: string): Promise<{
  status: 'success' | 'error';
  error?: string;
}> {
  console.log(`Testing RPC connection to: ${rpcUrl}`);
  
  try {
    // If chainId is provided, try all fallbacks using the enhanced getWorkingProvider
    if (chainId && CHAINS_CONFIG[chainId]) {
      try {
        console.log(`Testing connection to chain ID: ${chainId} (${CHAINS_CONFIG[chainId].chainName})`);
        await getWorkingProvider(CHAINS_CONFIG[chainId]);
        console.log(`Successfully connected to network: ${CHAINS_CONFIG[chainId].chainName}`);
        return { status: 'success' };
      } catch (error: any) {
        console.error(`All RPC connections failed for ${CHAINS_CONFIG[chainId].chainName}: ${error.message}`);
        return { 
          status: 'error',
          error: `Failed to connect to ${CHAINS_CONFIG[chainId].chainName}: ${error.message}`
        };
      }
    }
    
    // If no chainId, test the specific URL with detailed diagnostics
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Set a timeout for the network check with detailed logging
    const networkPromise = provider.getNetwork().then(network => {
      console.log(`Successfully detected network: ${network.name} (Chain ID: ${network.chainId})`);
      return network;
    });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => {
        console.error(`Connection to ${rpcUrl} timed out after 10 seconds`);
        reject(new Error(`Network connection timeout: Could not detect network at ${rpcUrl} after 10 seconds`));
      }, 10000)
    );
    
    // Race the network check against the timeout
    await Promise.race([networkPromise, timeoutPromise]);
    
    // If we got here, the connection was successful
    return { status: 'success' };
  } catch (error: any) {
    // Detailed error reporting
    let errorMessage = '';
    
    if (error.message.includes("timeout")) {
      errorMessage = `RPC connection timed out: ${rpcUrl}`;
      console.error(errorMessage);
    } else if (error.message.includes("invalid response") || error.message.includes("missing response")) {
      errorMessage = `Invalid RPC response from: ${rpcUrl}`;
      console.error(errorMessage);
    } else if (error.code === "ECONNREFUSED" || error.message.includes("connection refused")) {
      errorMessage = `Connection refused by: ${rpcUrl}`;
      console.error(errorMessage);
    } else if (error.message.includes("getaddrinfo") || error.message.includes("ENOTFOUND")) {
      errorMessage = `DNS resolution failed for: ${rpcUrl} - The URL may be incorrect`;
      console.error(errorMessage);
    } else {
      errorMessage = `RPC connection failed: ${error.message}`;
      console.error(errorMessage);
    }
    
    return { 
      status: 'error',
      error: errorMessage
    };
  }
}

// Type for transaction history items
export interface TransactionHistoryItem {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  confirmations: number;
  status: boolean | null;
}

// Get transaction history for an address
export async function getTransactionHistory(
  address: string,
  chain: Chain,
  limit: number = 10
): Promise<TransactionHistoryItem[]> {
  try {
    const provider = await getWorkingProvider(chain);
    
    // Get current block number
    const currentBlock = await provider.getBlockNumber();
    const history: TransactionHistoryItem[] = [];
    
    // We'll look at the last 10000 blocks or less
    const lookbackBlocks = Math.min(10000, currentBlock);
    const fromBlock = currentBlock - lookbackBlocks;
    
    // Get transactions where the address is sender or receiver
    const sentLogs = await provider.getLogs({
      fromBlock,
      toBlock: 'latest',
      topics: [null],
      address: address.toLowerCase()});

    // Process logs to get unique transaction hashes
    const txHashes = new Set<string>();
    for (const log of sentLogs) {
      if (log.transactionHash) {
        txHashes.add(log.transactionHash);
      }
    }

    // Get full transaction details
    for (const hash of Array.from(txHashes).slice(0, limit)) {
      try {
        const tx = await provider.getTransaction(hash);
        const receipt = await provider.getTransactionReceipt(hash);
        if (tx && receipt) {
          // Only include transactions involving our address
          if (tx.from.toLowerCase() === address.toLowerCase() || 
              tx.to?.toLowerCase() === address.toLowerCase()) {
            const block = await provider.getBlock(receipt.blockNumber);
            history.push({
              hash: tx.hash,
              from: tx.from,
              to: tx.to || '',
              value: ethers.utils.formatEther(tx.value),
              timestamp: block.timestamp,
              confirmations: receipt.confirmations,
              status: null
            });
          }
        }
      } catch (err) {
        console.error('Error fetching transaction details:', err);
      }
    }

    // Sort by timestamp descending
    return history.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    return [];
  }
}