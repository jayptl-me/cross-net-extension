// Account interface represents a wallet account with its essential properties
export interface Account {
  address: string;
  privateKey: string;
  balance: string;
  passwordHash?: string; // Hash of the password used to protect the private key
  mnemonic?: string; // 12-word seed phrase used to generate the wallet
}