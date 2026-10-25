/**
 * lib/web3/receipts.js
 * Asynchronously pins finished chores to IPFS and logs Proof-of-Arbitrage on Polygon Amoy.
 */

import { pinBasketReceipt, pinPriceHuntReceipt } from './ipfs.js';
import { recordProofOnChain } from './chain.js';

export async function processJobWeb3Artifacts(job) {
  if (!job || !job.result) return null;

  try {
    let ipfsResult = null;
    let savingsInr = 0;
    let items = [];

    if (['basket', 'saarthi', 'jhola'].includes(job.type)) {
      ipfsResult = await pinBasketReceipt(job).catch(() => null);
      savingsInr = job.result?.split?.savings || job.result?.savings || 0;
      items = job.input?.items || job.result?.items || [];
    } else if (job.type === 'price_hunt') {
      ipfsResult = await pinPriceHuntReceipt(job).catch(() => null);
      const best = job.result?.best;
      if (best && job.result?.options?.length > 1) {
        const highest = Math.max(...job.result.options.map((o) => o.price || 0));
        savingsInr = Math.max(0, highest - (best.price || 0));
      }
      items = [job.input?.product || job.title];
    }

    let onchain = null;
    const userWallet = job.input?.walletAddress || process.env.WEB3_DEPLOYER_WALLET || null;

    if (ipfsResult) {
      onchain = await recordProofOnChain({
        user: userWallet,
        items,
        savingsInr,
        ipfsCid: ipfsResult.cid,
      }).catch((e) => {
        console.warn('[web3] onchain error:', e.message);
        return null;
      });
    }

    return {
      ipfs: ipfsResult,
      onchain,
    };
  } catch (err) {
    console.warn('[web3] processJobWeb3Artifacts failed:', err.message);
    return null;
  }
}
