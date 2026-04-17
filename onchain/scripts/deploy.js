const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { waitForReceipt } = require("./waitForReceiptGeth");

/**
 * 使用手动 sendTransaction + waitForReceipt，避免 Geth 索引未完成时 ethers wait() 失败。
 */
async function deployContract(factory, ...args) {
  const [deployer] = await hre.ethers.getSigners();
  const txReq = await factory.getDeployTransaction(...args);
  const tx = await deployer.sendTransaction(txReq);
  const receipt = await waitForReceipt(deployer.provider, tx.hash);
  if (!receipt.contractAddress) {
    throw new Error("receipt 中无 contractAddress");
  }
  return factory.attach(receipt.contractAddress);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("部署账户:", deployer.address);

  const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
  const verifier = await deployContract(Verifier);
  const verifierAddr = await verifier.getAddress();
  console.log("Groth16Verifier:", verifierAddr);

  const Registry = await hre.ethers.getContractFactory("MerkleRootRegistry");
  const registry = await deployContract(Registry);
  const registryAddr = await registry.getAddress();
  console.log("MerkleRootRegistry:", registryAddr);

  const Gateway = await hre.ethers.getContractFactory("GradeZkGateway");
  const gateway = await deployContract(Gateway, verifierAddr, registryAddr);
  const gatewayAddr = await gateway.getAddress();
  console.log("GradeZkGateway:", gatewayAddr);

  const out = path.join(__dirname, "..", "deployed.json");
  const payload = {
    Groth16Verifier: verifierAddr,
    MerkleRootRegistry: registryAddr,
    GradeZkGateway: gatewayAddr,
    network: "geth",
  };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  console.log("地址已写入:", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
