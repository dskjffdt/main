/**
 * 读取 snarkjs 的 proof.json / public.json，在链上调用 GradeZkGateway.verifyProof。
 * 编码方式与 snarkjs groth16_exportSolidityCallData 一致。
 *
 * 仅支持网关：证明中的 root（public[0]）须与 MerkleRootRegistry.merkleRoot 一致；
 * 未设置根时请运行: npm run set-registry-root
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function toCallArgs(proof, publicSignals) {
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const pC = [proof.pi_c[0], proof.pi_c[1]];
  const pubSignals = publicSignals.map((x) => x);
  return { pA, pB, pC, pubSignals };
}

function resolveProofBase() {
  if (process.env.PROOF_DIR) return process.env.PROOF_DIR;
  const localZk = path.join(__dirname, "..", "zk");
  const proverDefault = path.join(__dirname, "..", "..", "grade_disclosure");
  const hasPair =
    fs.existsSync(path.join(localZk, "proof.json")) &&
    fs.existsSync(path.join(localZk, "public.json"));
  return hasPair ? localZk : proverDefault;
}

async function main() {
  const base = resolveProofBase();
  const proofPath = path.join(base, "proof.json");
  const publicPath = path.join(base, "public.json");
  const deployedPath = path.join(__dirname, "..", "deployed.json");

  if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath)) {
    throw new Error(
      `缺少 ${proofPath} 或 ${publicPath}。请先在 grade_disclosure 生成证明，或将二者复制到 onchain/zk/，或设置环境变量 PROOF_DIR`,
    );
  }
  if (!fs.existsSync(deployedPath)) {
    throw new Error("缺少 deployed.json，请先运行: npm run deploy");
  }

  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  if (!deployed.GradeZkGateway) {
    throw new Error("deployed.json 中无 GradeZkGateway，请重新 npm run deploy");
  }

  if (publicSignals.length !== 4) {
    throw new Error(
      `public.json 应有 4 个公开信号 [root, min, max, subjectId]，当前为 ${publicSignals.length} 个。请用当前电路重新生成证明。`,
    );
  }

  const name = "GradeZkGateway";
  const addr = deployed.GradeZkGateway;

  const { pA, pB, pC, pubSignals } = toCallArgs(proof, publicSignals);

  const c = await hre.ethers.getContractAt(name, addr);
  const ok = await c.verifyProof(pA, pB, pC, pubSignals);

  console.log(`链上 ${name}.verifyProof:`, ok ? "通过" : "失败");
  if (!ok && deployed.MerkleRootRegistry) {
    const reg = await hre.ethers.getContractAt("MerkleRootRegistry", deployed.MerkleRootRegistry);
    const onChainRoot = await reg.merkleRoot();
    const inited = await reg.rootInitialized();
    console.log("提示（网关要求公示根与证明中 root 一致）:");
    console.log("  Registry.rootInitialized:", inited);
    console.log("  Registry.merkleRoot:     ", onChainRoot.toString());
    console.log("  public.json [0] (root):  ", pubSignals[0]);
    console.log("  可运行: npm run set-registry-root 将 public[0] 写入 Registry");
  }
  if (ok) {
    console.log("公开信号 (root, min, max, subjectId):");
    pubSignals.forEach((s, i) => console.log(`  [${i}] ${s}`));
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
