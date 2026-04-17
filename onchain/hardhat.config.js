const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

require("@nomicfoundation/hardhat-toolbox");

/** 去掉引号/空格，避免 .env 里写 DEPLOYER_KEY="0x..." 时偶发异常 */
function normalizePrivateKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^["']|["']$/g, "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return null;
  return s;
}

const deployerKey = normalizePrivateKey(process.env.DEPLOYER_KEY);
if (process.env.DEPLOYER_KEY && !deployerKey) {
  throw new Error(
    "DEPLOYER_KEY 已设置但格式无效（应为 0x 开头、共 66 字符的私钥）。请检查 onchain/.env",
  );
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    geth: {
      url: process.env.GETH_RPC || "http://127.0.0.1:8545",
      chainId: Number(process.env.GETH_CHAIN_ID || 1337),
      accounts: deployerKey
        ? [deployerKey]
        : [
            "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
          ],
    },
  },
};
