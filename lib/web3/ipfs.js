/**
 * lib/web3/ipfs.js
 * IPFS pinning via Pinata for immutable Saarthi order receipts.
 */
import fs from 'node:fs';

if (fs.existsSync('.env') && !process.env.PINATA_JWT) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
}

const PINATA_API_KEY    = process.env.PINATA_API_KEY    || '';
const PINATA_API_SECRET = process.env.PINATA_API_SECRET || '';
const PINATA_JWT        = process.env.PINATA_JWT        || '';

const PINATA_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
const GATEWAY    = 'https://gateway.pinata.cloud/ipfs';

export async function pinToIPFS(name, data) {
  const jwt = process.env.PINATA_JWT || PINATA_JWT;
  const apiKey = process.env.PINATA_API_KEY || PINATA_API_KEY;
  const apiSecret = process.env.PINATA_API_SECRET || PINATA_API_SECRET;

  if (!jwt && (!apiKey || !apiSecret)) return null;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt.trim()}`;
    } else {
      headers['pinata_api_key'] = apiKey.trim();
      headers['pinata_secret_api_key'] = apiSecret.trim();
    }

    const body = {
      pinataContent: {
        saarthi_version: '1.0-web3',
        network: 'polygon-amoy',
        created_at: new Date().toISOString(),
        ...data,
      },
      pinataMetadata: {
        name: `saarthi-${name}-${Date.now()}`,
        keyvalues: {
          type: name,
          protocol: 'saarthi-web3',
        },
      },
      pinataOptions: { cidVersion: 1 },
    };

    const res = await fetch(PINATA_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json();

    if (!res.ok) {
      console.warn('[ipfs] Pinata error:', json);
      return null;
    }

    const cid = json.IpfsHash;
    return {
      cid,
      ipfsUrl: `ipfs://${cid}`,
      gatewayUrl: `${GATEWAY}/${cid}`,
    };
  } catch (err) {
    console.warn('[ipfs] pinToIPFS failed:', err.message);
    return null;
  }
}

export async function pinBasketReceipt(job) {
  return pinToIPFS('basket-receipt', {
    job_id: job.id,
    job_type: job.type,
    title: job.title,
    result: job.result,
    created_at: new Date(job.createdAt).toISOString(),
    finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  });
}

export async function pinPriceHuntReceipt(job) {
  return pinToIPFS('price-hunt-receipt', {
    job_id: job.id,
    job_type: job.type,
    title: job.title,
    result: job.result,
    created_at: new Date(job.createdAt).toISOString(),
    finished_at: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  });
}
