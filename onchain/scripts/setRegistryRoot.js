/**
 * 将公示 Merkle 根写入 MerkleRootRegistry（需部署账户为 owner）。
 * 根节点默认从 zk_circuit 生成的 merkle_publication.json 读取（与电路/证明数据源一致），
 * 而非从某次证明输出的 public.json，避免目录不一致时写错根。
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { waitForReceipt } = require("./waitForReceiptGeth");

const DEFAULT_PUBLICATION = path.join(
  __dirname,
  "..",
  "..",
  "zk_circuit",
  "generated",
  "merkle_publication.json",
);

function readRootFromPublication(pubPath) {
  const raw = JSON.parse(fs.readFileSync(pubPath, "utf8"));
  if (raw.merkleRoot === undefined && raw.merkle_root !== undefined) {
    return String(raw.merkle_root);
  }
  if (raw.merkleRoot === undefined) {
    throw new Error(`${pubPath} 中缺少 merkleRoot 字段`);
  }
  return String(raw.merkleRoot);
}

async function main() {
  const deployedPath = path.join(__dirname, "..", "deployed.json");
  if (!fs.existsSync(deployedPath)) throw new Error("缺少 deployed.json");

  /** 公示文件路径；也可 MERKLE_PUBLICATION_JSON=... */
  const pubPath =
    process.env.MERKLE_PUBLICATION_JSON ||
    process.env.MERKLE_PUBLICATION_PATH ||
    DEFAULT_PUBLICATION;

  let root;
  let sourceNote;

  if (fs.existsSync(pubPath)) {
    root = readRootFromPublication(pubPath);
    sourceNote = `merkle_publication: ${pubPath}`;
  } else {
    const base =
      process.env.PROOF_DIR ||
      path.join(__dirname, "..", "..", "grade_disclosure");
    const publicPath = path.join(base, "public.json");
    if (!fs.existsSync(publicPath)) {
      throw new Error(
        `未找到公示文件 ${pubPath}，且回退用的 ${publicPath} 也不存在。请生成 merkle_publication.json 或设置 MERKLE_PUBLICATION_JSON / PROOF_DIR`,
      );
    }
    const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));
    if (publicSignals.length < 1) throw new Error("public.json 至少需含 root（下标 0）");
    root = String(publicSignals[0]);
    sourceNote = `回退 public.json: ${publicPath}`;
    console.warn("提示: 未找到 merkle_publication.json，已用 public.json[0]；建议改用 generated/merkle_publication.json 作为唯一数据源");
  }

  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  if (!deployed.MerkleRootRegistry) throw new Error("deployed.json 中无 MerkleRootRegistry");

  const reg = await hre.ethers.getContractAt("MerkleRootRegistry", deployed.MerkleRootRegistry);
  const tx = await reg.setMerkleRoot(root);
  await waitForReceipt(hre.ethers.provider, tx.hash);
  console.log("已 setMerkleRoot:", root);
  console.log("来源:", sourceNote);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
