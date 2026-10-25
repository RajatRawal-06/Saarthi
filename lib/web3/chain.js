/**
 * lib/web3/chain.js
 * Real Polygon Amoy Blockchain integration for Saarthi.
 */
import fs from 'node:fs';
import { ethers } from 'ethers';
import { readJSON, writeJSON } from '../store.js';

if (fs.existsSync('.env') && !process.env.WEB3_DEPLOYER_PRIVATE_KEY) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

const RPC_URL = process.env.POLYGON_AMOY_RPC || 'https://polygon-amoy-bor-rpc.publicnode.com';
const DEPLOYER_KEY = process.env.WEB3_DEPLOYER_PRIVATE_KEY || '';

const CHAIN_FILE = 'web3.json';

const PROOF_ABI = [
  'event ArbitrageProof(bytes32 indexed proofHash, address indexed user, uint256 savingsInr, uint256 timestamp, string ipfsCid)',
  'function recordProof(bytes32 proofHash, address user, uint256 savingsInr, string calldata ipfsCid) external',
  'function linkWallet(string calldata pincode) external',
  'function setTokenContract(address _token) external',
  'function getStats() external view returns (uint256, uint256, address, address)',
  'function getUserStats(address user) external view returns (uint256, uint256, string)',
  'function proofExists(bytes32) external view returns (bool)',
];

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function setProofContract(address) external',
  'function mint(address to, uint256 amount) external',
  'event Mint(address indexed to, uint256 amount)',
];

let _provider = null;
let _signer = null;

export function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return _provider;
}

export function getSigner() {
  const key = process.env.WEB3_DEPLOYER_PRIVATE_KEY || DEPLOYER_KEY;
  if (!key) return null;
  if (!_signer) {
    _signer = new ethers.Wallet(key, getProvider());
  }
  return _signer;
}

export function getContractAddresses() {
  const saved = readJSON(CHAIN_FILE, {});
  return saved.proofAddress ? saved : null;
}

export function getContracts() {
  const addrs = getContractAddresses();
  if (!addrs) return null;
  const signer = getSigner();
  const provider = getProvider();
  const proof = new ethers.Contract(addrs.proofAddress, PROOF_ABI, signer || provider);
  const token = new ethers.Contract(addrs.tokenAddress, TOKEN_ABI, signer || provider);
  return { proof, token, ...addrs };
}

export function buildProofHash(user, items, savingsPaise, timestamp) {
  return ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256', 'uint256'],
    [
      user || ethers.ZeroAddress,
      JSON.stringify(items || []),
      BigInt(Math.round(savingsPaise || 0)),
      BigInt(timestamp || Date.now()),
    ]
  );
}

export async function recordProofOnChain({ user, items, savingsInr, ipfsCid }) {
  const contracts = getContracts();
  const signer = getSigner();
  if (!contracts || !signer) {
    console.warn('[web3] Missing contracts or signer');
    return null;
  }

  try {
    const savingsPaise = Math.round((savingsInr || 0) * 100);
    const timestamp = Date.now();
    const proofHash = buildProofHash(user, items, savingsPaise, timestamp);

    console.log('[web3] Submitting on-chain proof transaction to Polygon Amoy...');
    const tx = await contracts.proof.recordProof(
      proofHash,
      user || ethers.ZeroAddress,
      BigInt(savingsPaise),
      ipfsCid || ''
    );
    const receipt = await tx.wait();

    console.log('[web3] Proof confirmed in block:', receipt.blockNumber, 'tx:', receipt.hash);
    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      proofHash,
      explorerUrl: `https://amoy.polygonscan.com/tx/${receipt.hash}`,
      network: 'Polygon Amoy Testnet',
    };
  } catch (err) {
    console.warn('[web3] recordProof failed:', err.message);
    return null;
  }
}

export async function getChainStats() {
  const contracts = getContracts();
  if (!contracts) return null;
  try {
    const [totalProofs, totalSavingsPaise, owner, tokenContract] = await contracts.proof.getStats();
    const tokenSupply = await contracts.token.totalSupply();
    return {
      totalProofs: Number(totalProofs),
      totalSavingsInr: Number(totalSavingsPaise) / 100,
      tokenSupply: ethers.formatEther(tokenSupply),
      proofAddress: contracts.proofAddress,
      tokenAddress: contracts.tokenAddress,
      owner,
      network: 'Polygon Amoy Testnet',
      explorerBase: 'https://amoy.polygonscan.com',
    };
  } catch (err) {
    console.warn('[web3] getChainStats failed:', err.message);
    return null;
  }
}

export async function getUserChainStats(walletAddress) {
  const contracts = getContracts();
  if (!contracts || !walletAddress) return null;
  try {
    const [proofCount, savingsPaise, pincode] = await contracts.proof.getUserStats(walletAddress);
    const tokenBalance = await contracts.token.balanceOf(walletAddress);
    return {
      proofCount: Number(proofCount),
      savingsInr: Number(savingsPaise) / 100,
      tokenBalance: ethers.formatEther(tokenBalance),
      pincode: pincode || null,
      walletAddress,
      network: 'Polygon Amoy Testnet',
      explorerUrl: `https://amoy.polygonscan.com/address/${walletAddress}`,
    };
  } catch (err) {
    console.warn('[web3] getUserStats failed:', err.message);
    return null;
  }
}

export async function web3Status() {
  const addrs = getContractAddresses();
  if (!addrs) return { ready: false, reason: 'Contracts not deployed' };
  try {
    const block = await getProvider().getBlockNumber();
    const signer = getSigner();
    const balance = signer ? ethers.formatEther(await getProvider().getBalance(signer.address)) : '0';
    return {
      ready: true,
      network: 'Polygon Amoy Testnet',
      chainId: 80002,
      block,
      deployer: signer?.address,
      deployerBalance: balance,
      proofAddress: addrs.proofAddress,
      tokenAddress: addrs.tokenAddress,
      proofExplorer: `https://amoy.polygonscan.com/address/${addrs.proofAddress}`,
      tokenExplorer: `https://amoy.polygonscan.com/address/${addrs.tokenAddress}`,
    };
  } catch (err) {
    return { ready: false, reason: err.message };
  }
}
