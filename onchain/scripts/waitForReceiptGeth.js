/**
 * Geth 1.13.11+ 在后台建立交易索引时，eth_getTransactionReceipt 可能暂时返回
 * "transaction indexing is in progress"，ethers 的 tx.wait() / waitForDeployment() 会直接抛错。
 * 此处轮询并在遇到该错误时重试（与 web3.py 等对 Geth 的兼容做法一致）。
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isIndexingError(e) {
  const m = (e && (e.message || e.shortMessage)) || String(e);
  return (
    m.includes("transaction indexing is in progress") ||
    m.includes("indexing is in progress")
  );
}

async function waitForReceipt(provider, txHash, opts = {}) {
  const maxMs = opts.maxMs ?? 180000;
  const pollMs = opts.pollMs ?? 400;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        if (receipt.status === 0) {
          throw new Error("transaction reverted");
        }
        return receipt;
      }
    } catch (e) {
      if (isIndexingError(e)) {
        await sleep(pollMs);
        continue;
      }
      throw e;
    }
    await sleep(pollMs);
  }
  throw new Error(`等待交易确认超时: ${txHash}`);
}

module.exports = { waitForReceipt, isIndexingError };
