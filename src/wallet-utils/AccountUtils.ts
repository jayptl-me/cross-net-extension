// Account utilities for creating and managing wallet accounts
import { ethers } from "ethers";
import { Account } from "../interfaces/Account";

// Simple hash function for passwords
export function hashPassword(password: string): string {
  // In a production app, use a proper hashing library with salt
  // This is a simplified version for demo purposes
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(password));
}

// Verify password against stored hash
export function verifyPassword(password: string, hash: string): boolean {
  const inputHash = hashPassword(password);
  return inputHash === hash;
}

// Create a new random account with password protection
export function createAccount(password?: string): Account {
  const wallet = ethers.Wallet.createRandom();
  // Extract the mnemonic phrase from the wallet
  const mnemonic = wallet.mnemonic.phrase;
  
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    balance: "0",
    mnemonic: mnemonic, // Store the mnemonic phrase
    ...(password ? { passwordHash: hashPassword(password) } : {})
  };
}

// Check if a private key already exists in localStorage
export function getExistingAccountByPrivateKey(privateKey: string): Account | null {
  const accountData = localStorage.getItem('mini-wallet-account');
  if (accountData) {
    const savedAccount = JSON.parse(accountData) as Account;
    if (savedAccount.privateKey === privateKey) {
      return savedAccount;
    }
  }
  return null;
}

// Create an account from an existing private key
export function importAccount(privateKey: string, password?: string): Account {
  // Check if this private key already exists in localStorage
  const existingAccount = getExistingAccountByPrivateKey(privateKey);
  
  if (existingAccount) {
    // If the account has a password hash, verify the provided password
    if (existingAccount.passwordHash && password) {
      if (!verifyPassword(password, existingAccount.passwordHash)) {
        throw new Error("Incorrect password for this private key");
      }
      // Password is correct, return the existing account
      return existingAccount;
    }
    
    // If the existing account doesn't have a password but one is provided now, add it
    if (!existingAccount.passwordHash && password) {
      existingAccount.passwordHash = hashPassword(password);
      // Save the updated account with the new password
      saveAccount(existingAccount);
      return existingAccount;
    }
    
    // Otherwise, just return the existing account
    return existingAccount;
  }
  
  // This is a new private key, create a fresh account
  const wallet = new ethers.Wallet(privateKey);
  return {
    address: wallet.address,
    privateKey: privateKey,
    balance: "0",
    ...(password ? { passwordHash: hashPassword(password) } : {})
  };
}

// Update the password for an existing account
export function updateAccountPassword(account: Account, oldPassword: string | undefined, newPassword: string): Account {
  // Check if account has a password that needs to be verified
  if (account.passwordHash && oldPassword) {
    if (!verifyPassword(oldPassword, account.passwordHash)) {
      throw new Error("Current password is incorrect");
    }
  }
  
  // Set the new password hash
  account.passwordHash = hashPassword(newPassword);
  
  // Save the updated account
  saveAccount(account);
  
  return account;
}

// Import account from mnemonic phrase
export function importAccountFromMnemonic(mnemonic: string, password?: string): Account {
  // Create a wallet from the mnemonic phrase
  const wallet = ethers.Wallet.fromMnemonic(mnemonic);
  
  // Check if this private key already exists
  const existingAccount = getExistingAccountByPrivateKey(wallet.privateKey);
  
  if (existingAccount) {
    // If the account has a password hash, verify the provided password
    if (existingAccount.passwordHash && password) {
      if (!verifyPassword(password, existingAccount.passwordHash)) {
        throw new Error("Incorrect password for this seed phrase");
      }
      return existingAccount;
    }
    
    // If the existing account doesn't have a password but one is provided now, add it
    if (!existingAccount.passwordHash && password) {
      existingAccount.passwordHash = hashPassword(password);
      saveAccount(existingAccount);
      return existingAccount;
    }
    
    // Otherwise just return the existing account
    return existingAccount;
  }
  
  // This is a new account from the mnemonic
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    balance: "0",
    mnemonic: mnemonic,
    ...(password ? { passwordHash: hashPassword(password) } : {})
  };
}

// Save account to localStorage
export function saveAccount(account: Account | null): void {
  if (account) {
    localStorage.setItem('mini-wallet-account', JSON.stringify(account));
  } else {
    localStorage.removeItem('mini-wallet-account');
  }
}

// Load account from localStorage
export function loadAccount(): Account | null {
  const accountData = localStorage.getItem('mini-wallet-account');
  return accountData ? JSON.parse(accountData) : null;
}