/**
 * 将 verifier.sol 复制到 onchain/contracts/Groth16Verifier.sol。
 * 复制后请在 onchain 自行执行 npx hardhat compile、按需 deploy。
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cirRoot = path.join(__dirname, "..");
const src = path.join(cirRoot, "verifier.sol");
const dest = path.join(cirRoot, "..", "onchain", "contracts", "Groth16Verifier.sol");

async function main() {
  try {
    await fs.access(src);
  } catch {
    throw new Error(`找不到源文件: ${src}(请先 npm run export-solidity)`);
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  console.log("已复制:");
  console.log("  ", src);
  console.log("->", dest);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
