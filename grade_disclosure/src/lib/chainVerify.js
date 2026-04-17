/**
 * 链上验证：对 GradeZkGateway 合约调用 verifyProof（与 onchain/scripts/verifyOnChain.js 一致）。
 *
 * - 合约地址：读 onchain/deployed.json 中的 GradeZkGateway（可选覆盖 GATEWAY_ADDRESS / DEPLOYED_JSON）。
 * - 节点 RPC：环境变量 ETH_RPC_URL 或 RPC_URL，填你在 MetaMask「自定义网络」里用的同一个 HTTP RPC 即可
 *   （本机 Geth 多为 http://127.0.0.1:8545；公网测试网则用 Infura/Alchemy 等 URL）。
 * 浏览器钱包无法把 RPC 自动传给本机后端，故须在运行 Node 的环境里设一次。
 */
import { ethers } from "ethers";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GATEWAY_ABI = [
  "function verifyProof(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[4] calldata _pubSignals) external view returns (bool)",
];

const REGISTRY_ABI = [
  "function merkleRoot() view returns (uint256)",
  "function rootInitialized() view returns (bool)",
];

export function toProofCallArgs(proof, publicSignals) {
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const pC = [proof.pi_c[0], proof.pi_c[1]];
  const pubSignals = publicSignals.map((x) => x);
  return { pA, pB, pC, pubSignals };
}

/** 默认 zk_grade/onchain/deployed.json；可用 DEPLOYED_JSON 覆盖 */
export function resolveDeployedJsonPath() {
  if (process.env.DEPLOYED_JSON) return path.resolve(process.env.DEPLOYED_JSON);
  return path.join(__dirname, "..", "..", "..", "onchain", "deployed.json");
}

function getRpcUrl() {
  return process.env.ETH_RPC_URL || process.env.RPC_URL || "";
}

/**
 * 仅读取本地 proof/public，链参数全部来自服务端配置。
 * @param {string} outDir — 含 proof.json、public.json
 */
export async function verifyOnChainGateway(outDir) {
  const rpc = getRpcUrl();
  if (!rpc) {
    const e = new Error("服务端未配置链连接（管理员需设置环境变量 ETH_RPC_URL 或 RPC_URL）");
    e.code = "CHAIN_NOT_CONFIGURED";
    throw e;
  }

  const out = path.resolve(String(outDir));
  const proofPath = path.join(out, "proof.json");
  const publicPath = path.join(out, "public.json");

  let proofRaw;
  let publicRaw;
  try {
    proofRaw = await fs.readFile(proofPath, "utf8");
    publicRaw = await fs.readFile(publicPath, "utf8");
  } catch {
    throw new Error(`缺少 ${proofPath} 或 ${publicPath}`);
  }

  const proof = JSON.parse(proofRaw);
  const publicSignals = JSON.parse(publicRaw);

  if (publicSignals.length !== 4) {
    throw new Error(
      `public.json 应有 4 个公开信号 [root, min, max, subjectId]，当前为 ${publicSignals.length} 个`,
    );
  }

  const depPath = resolveDeployedJsonPath();
  let deployed;
  try {
    deployed = JSON.parse(await fs.readFile(depPath, "utf8"));
  } catch {
    const e = new Error(
      `服务端找不到合约部署信息（deployed.json）。请管理员部署合约并配置 DEPLOYED_JSON 或放置默认路径文件。`,
    );
    e.code = "DEPLOYED_JSON_MISSING";
    throw e;
  }

  const gateway = process.env.GATEWAY_ADDRESS || deployed.GradeZkGateway;
  if (!gateway) {
    const e = new Error("未配置网关合约地址（deployed.json 中无 GradeZkGateway，或设置 GATEWAY_ADDRESS）");
    e.code = "GATEWAY_MISSING";
    throw e;
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(gateway, GATEWAY_ABI, provider);
  const { pA, pB, pC, pubSignals } = toProofCallArgs(proof, publicSignals);

  const ok = await contract.verifyProof(pA, pB, pC, pubSignals);

  let hint = null;
  if (!ok && deployed.MerkleRootRegistry) {
    try {
      const reg = new ethers.Contract(deployed.MerkleRootRegistry, REGISTRY_ABI, provider);
      const [merkleRoot, inited] = await Promise.all([
        reg.merkleRoot(),
        reg.rootInitialized(),
      ]);
      hint = {
        rootInitialized: inited,
        registryMerkleRoot: merkleRoot.toString(),
        proofRoot: String(pubSignals[0]),
        note: "证明中的 root 须与链上公示根一致；由管理员维护 Registry。",
      };
    } catch {
      hint = { note: "无法读取 Registry 状态" };
    }
  }

  return {
    ok,
    publicSignals,
    gateway,
    via: "GradeZkGateway",
    hint,
  };
}

export { getRpcUrl };
