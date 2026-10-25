import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { ethers } from 'ethers';

// Load .env
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const RPC_URL = process.env.POLYGON_AMOY_RPC || 'https://polygon-amoy-bor-rpc.publicnode.com';
const PRIVATE_KEY = process.env.WEB3_DEPLOYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Missing WEB3_DEPLOYER_PRIVATE_KEY in .env');
  process.exit(1);
}

console.log('🔄 Connecting to Polygon Amoy via:', RPC_URL);
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

console.log('Deployer address:', wallet.address);
const balance = await provider.getBalance(wallet.address);
console.log('Deployer balance:', ethers.formatEther(balance), 'POL');

if (balance === 0n) {
  console.error('Wallet balance is 0. Please claim test POL first.');
  process.exit(1);
}

console.log('\n🔨 Compiling Solidity contracts with solc...');
const tokenSrc = fs.readFileSync('contracts/SaarthiToken.sol', 'utf8');
const proofSrc = fs.readFileSync('contracts/SaarthiProof.sol', 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'SaarthiToken.sol': { content: tokenSrc },
    'SaarthiProof.sol': { content: proofSrc },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  if (fatal.length) {
    console.error('Compilation failed:', fatal);
    process.exit(1);
  }
}

const tokenAbi = output.contracts['SaarthiToken.sol']['SaarthiToken'].abi;
const tokenBytecode = output.contracts['SaarthiToken.sol']['SaarthiToken'].evm.bytecode.object;

const proofAbi = output.contracts['SaarthiProof.sol']['SaarthiProof'].abi;
const proofBytecode = output.contracts['SaarthiProof.sol']['SaarthiProof'].evm.bytecode.object;

console.log('✅ Contracts compiled successfully!');

console.log('\n🚀 Deploying SaarthiToken ($SAARTHI)...');
const TokenFactory = new ethers.ContractFactory(tokenAbi, '0x' + tokenBytecode, wallet);
const tokenContract = await TokenFactory.deploy();
await tokenContract.waitForDeployment();
const tokenAddress = await tokenContract.getAddress();
console.log('✅ SaarthiToken deployed at:', tokenAddress);

console.log('\n🚀 Deploying SaarthiProof...');
const ProofFactory = new ethers.ContractFactory(proofAbi, '0x' + proofBytecode, wallet);
const proofContract = await ProofFactory.deploy();
await proofContract.waitForDeployment();
const proofAddress = await proofContract.getAddress();
console.log('✅ SaarthiProof deployed at:', proofAddress);

console.log('\n🔗 Linking contracts together...');
const tx1 = await tokenContract.setProofContract(proofAddress);
await tx1.wait();
console.log('✅ SaarthiToken.setProofContract confirmed');

const tx2 = await proofContract.setTokenContract(tokenAddress);
await tx2.wait();
console.log('✅ SaarthiProof.setTokenContract confirmed');

const outData = {
  network: 'Polygon Amoy Testnet',
  chainId: 80002,
  proofAddress,
  tokenAddress,
  deployerAddress: wallet.address,
  deployedAt: Date.now(),
  proofAbi,
  tokenAbi,
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/web3.json', JSON.stringify(outData, null, 2));
fs.mkdirSync('defaults', { recursive: true });
fs.writeFileSync('defaults/web3.json', JSON.stringify(outData, null, 2));

console.log('\n🎉 ALL CONTRACTS DEPLOYED & CONFIGURED!');
console.log('Proof Contract:  https://amoy.polygonscan.com/address/' + proofAddress);
console.log('Token Contract:  https://amoy.polygonscan.com/address/' + tokenAddress);
