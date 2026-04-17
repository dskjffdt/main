/**
 * Groth16 证明/验证核心逻辑（供 grade_disclosure 服务端与 CLI 复用）
 */
import fs from "fs/promises";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import * as snarkjs from "snarkjs";
import {
  buildWitnessInputFromFields,
  MERKLE_LEVELS,
  NUM_LEAVES,
} from "../../../zk_circuit/tools/merkle_witness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { MERKLE_LEVELS, NUM_LEAVES };

export function getDefaultSnarkBase(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SNARK_BASE) return path.resolve(process.env.SNARK_BASE);
  return path.join(__dirname, "..", "..", "..", "zk_circuit");
}

/** Windows 默认 C:\\zk-snark-output；其它系统为家目录下 zk-snark-output */
export function getDefaultOutputDirectorySync() {
  if (process.platform === "win32") {
    return "C:\\zk-snark-output";
  }
  return path.join(os.homedir(), "zk-snark-output");
}

export { getDefaultOutputDirectorySync as getDefaultOutputDirectory };

export function buildPaths(snarkBase) {
  const base = getDefaultSnarkBase(snarkBase);
  return {
    base,
    zkey: path.join(base, "circuit_final.zkey"),
    vkey: path.join(base, "verification_key.json"),
    wasmCandidates: [
      path.join(base, "build", "circuit_js", "circuit.wasm"),
      path.join(base, "circuit_js", "circuit.wasm"),
    ],
    defaultPublication: path.join(base, "generated", "merkle_publication.json"),
    defaultLeaves: path.join(base, "generated", "leaves_layer0.json"),
  };
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonMaybeGzip(filePath) {
  const candidates = [];
  if (filePath.endsWith(".gz")) {
    candidates.push(filePath);
  } else {
    candidates.push(filePath);
    candidates.push(`${filePath}.gz`);
    if (filePath.endsWith(".json")) {
      candidates.push(filePath.replace(/\.json$/i, ".json.gz"));
    }
  }
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (!(await pathExists(p))) continue;
    const buf = await fs.readFile(p);
    if (p.endsWith(".gz")) {
      const zlib = await import("node:zlib");
      return JSON.parse((await zlib.promises.gunzip(buf)).toString("utf8"));
    }
    return JSON.parse(buf.toString("utf8"));
  }
  return null;
}

export async function findRecordInPublication(pubPath, leafIndex) {
  const pub = await readJsonMaybeGzip(pubPath);
  if (!pub) return { publication: null, record: null, shardIndex: null };

  const li = Number(leafIndex);
  if (Array.isArray(pub.records)) {
    const record = pub.records.find((r) => Number(r.leafIndex) === li);
    return { publication: pub, record: record ?? null, shardIndex: null };
  }

  const shardSize = pub.shardSize;
  if (shardSize == null || !Number.isFinite(Number(shardSize))) {
    return { publication: pub, record: null, shardIndex: null };
  }

  const rawCount = pub.recordCount ?? 0;
  const shardCount =
    pub.shardCount ?? Math.ceil(rawCount / Number(shardSize));
  if (!Number.isFinite(shardCount) || shardCount <= 0) {
    return { publication: pub, record: null, shardIndex: null };
  }

  const shardIdx = Math.floor(li / Number(shardSize));
  if (shardIdx < 0 || shardIdx >= shardCount) {
    return { publication: pub, record: null, shardIndex: shardIdx };
  }

  const dir = path.dirname(pubPath);
  const shardPath = path.join(dir, `merkle_publication_shard_${shardIdx}.json`);
  const shard = await readJsonMaybeGzip(shardPath);
  if (!shard?.records) {
    return { publication: pub, record: null, shardIndex: shardIdx };
  }
  const record = shard.records.find((r) => Number(r.leafIndex) === li);
  return { publication: pub, record: record ?? null, shardIndex: shardIdx };
}

export async function resolveWasmPath(snarkBase, cliWasm) {
  if (cliWasm) return cliWasm;
  if (process.env.SNARK_WASM) return process.env.SNARK_WASM;
  const { wasmCandidates } = buildPaths(snarkBase);
  for (const c of wasmCandidates) {
    if (await pathExists(c)) return c;
  }
  return wasmCandidates[0];
}

export async function proveOnce(args) {
  let witnessInput = args.witnessInput;
  if (!witnessInput && args.fields) {
    const opts = {};
    if (args.publicationRecord) opts.publicationRecord = args.publicationRecord;
    else if (args.leaves) opts.leaves = args.leaves;
    witnessInput = await buildWitnessInputFromFields(args.fields, opts);
  }
  if (!witnessInput) {
    throw new Error("缺少 witnessInput 或 fields");
  }

  const paths = buildPaths(args.snarkBase);
  const wasmPath = await resolveWasmPath(args.snarkBase, args.wasm);
  const zkeyPath = args.zkey || process.env.SNARK_ZKEY || paths.zkey;
  const outDir = path.resolve(args.outDir || getDefaultOutputDirectorySync());

  for (const [name, p] of [
    ["WASM", wasmPath],
    ["zkey", zkeyPath],
  ]) {
    if (!(await pathExists(p))) {
      throw new Error(`找不到 ${name}: ${p}`);
    }
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witnessInput,
    wasmPath,
    zkeyPath,
  );

  const proofOut = path.join(outDir, "proof.json");
  const publicOut = path.join(outDir, "public.json");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(proofOut, JSON.stringify(proof, null, 2), "utf8");
  await fs.writeFile(publicOut, JSON.stringify(publicSignals, null, 2), "utf8");

  return { proofPath: proofOut, publicPath: publicOut, proof, publicSignals };
}

export async function verifyOnce(args) {
  const outDir = args.outDir
    ? path.resolve(args.outDir)
    : getDefaultOutputDirectorySync();
  const proofPath = args.proof || path.join(outDir, "proof.json");
  const publicPath = args.public || path.join(outDir, "public.json");
  const paths = buildPaths(args.snarkBase);
  const vkeyPath = args.vkey || process.env.SNARK_VKEY || paths.vkey;

  for (const [name, p] of [
    ["证明", proofPath],
    ["公开信号", publicPath],
    ["验证密钥", vkeyPath],
  ]) {
    if (!(await pathExists(p))) {
      throw new Error(`找不到 ${name}: ${p}`);
    }
  }

  const proof = JSON.parse(await fs.readFile(proofPath, "utf8"));
  const publicSignals = JSON.parse(await fs.readFile(publicPath, "utf8"));
  const vkey = JSON.parse(await fs.readFile(vkeyPath, "utf8"));

  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  return { ok, publicSignals };
}

export function assertGradeInRange(minStr, maxStr, gradeStr) {
  let min;
  let max;
  let g;
  try {
    min = BigInt(minStr);
    max = BigInt(maxStr);
    g = BigInt(gradeStr);
  } catch {
    throw new Error("min / max / grade 须为整数（十进制）");
  }
  if (min > max) {
    throw new Error("min 不能大于 max");
  }
  if (g < min || g > max) {
    throw new Error(
      `成绩必须在公开区间 [min, max] 内：当前 grade=${gradeStr}，区间为 [${minStr}, ${maxStr}]`,
    );
  }
}

/**
 * 与旧 CLI 一致：根据 leafIndex 解析 merkle_publication / leaves_layer0
 */
export async function resolvePublicationAndLeaves(leafIndex, options) {
  const {
    snarkBase,
    merklePublicationJson,
    merkleLeavesJson,
    singleLeafDemo,
  } = options;
  const paths = buildPaths(snarkBase);
  const liNum = Number(leafIndex);
  let leaves = null;
  let publicationRecord = null;

  if (singleLeafDemo) {
    return { publicationRecord: null, leaves: null, messages: ["单叶子演示树"] };
  }

  const pubPath = merklePublicationJson
    ? path.resolve(merklePublicationJson)
    : paths.defaultPublication;

  const { publication: pub, record: rec, shardIndex } =
    await findRecordInPublication(pubPath, liNum);

  const messages = [];

  if (pub) {
    if (
      rec &&
      Array.isArray(rec.pathElements) &&
      rec.pathElements.length === MERKLE_LEVELS &&
      Array.isArray(rec.pathIndices) &&
      rec.pathIndices.length === MERKLE_LEVELS
    ) {
      publicationRecord = {
        merkleRoot: pub.merkleRoot,
        leafIndex: rec.leafIndex,
        leafHash: rec.leafHash,
        pathElements: rec.pathElements,
        pathIndices: rec.pathIndices,
      };
      messages.push(
        shardIndex != null
          ? `已使用 merkle_publication 分片 shard_${shardIndex}`
          : "已使用 merkle_publication 预存路径",
      );
    } else if (rec && (!rec.pathElements || !rec.pathIndices)) {
      messages.push("merkle_publication 记录缺少 path，将尝试 leaves_layer0");
    } else if (!rec && pub.shardSize != null) {
      messages.push(`未在分片中找到 leafIndex=${liNum}`);
    }
  }

  if (!publicationRecord) {
    const leavesJsonPath = merkleLeavesJson
      ? path.resolve(merkleLeavesJson)
      : paths.defaultLeaves;
    const raw = await readJsonMaybeGzip(leavesJsonPath);
    if (raw && Array.isArray(raw.leaves) && raw.leaves.length === NUM_LEAVES) {
      leaves = raw.leaves;
      messages.push(`已加载完整树叶: ${leavesJsonPath}`);
    } else {
      messages.push(
        raw
          ? "leaves 长度不符，使用单叶子演示树"
          : "未找到 merkle_publication 路径与 leaves_layer0，使用单叶子演示树",
      );
    }
  }

  return { publicationRecord, leaves, messages };
}
