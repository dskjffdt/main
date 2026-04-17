/**
 * 本地 HTTP API：证明在本地生成。
 * 链上验证：读 proof/public + onchain/deployed.json 里的合约地址，经 ETH_RPC_URL 调链（与 MetaMask 所用 RPC 同源即可）。
 */
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import {
  proveOnce,
  assertGradeInRange,
  resolvePublicationAndLeaves,
  getDefaultOutputDirectorySync,
  MERKLE_LEVELS,
  NUM_LEAVES,
} from "./lib/snarkCore.js";
import { verifyOnChainGateway, getRpcUrl, resolveDeployedJsonPath } from "./lib/chainVerify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

async function getChainVerifyStatus() {
  const rpc = getRpcUrl();
  let deployedOk = false;
  try {
    await fs.access(resolveDeployedJsonPath());
    deployedOk = true;
  } catch {
    deployedOk = false;
  }
  const ready = Boolean(rpc) && deployedOk;
  const label = process.env.ZK_NETWORK_LABEL || "";
  return {
    chainVerifyReady: ready,
    /** 仅面向终端用户的短句，不含环境变量名与文件名 */
    chainVerifyHint: ready
      ? label
        ? `在线核验已开通（${label}）`
        : "在线核验已开通"
      : "在线核验暂未开通，请联系单位管理员",
  };
}

app.get("/api/config", async (req, res) => {
  try {
    const chain = await getChainVerifyStatus();
    res.json({
      defaultOutDir: getDefaultOutputDirectorySync(),
      merkleLevels: MERKLE_LEVELS,
      numLeaves: NUM_LEAVES,
      maxLeaf: (1 << MERKLE_LEVELS) - 1,
      verifyMode: "chain",
      ...chain,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

function envFlag(name) {
  const v = process.env[name];
  return v === "1" || v === "true" || v === "yes";
}

app.post("/api/prove", async (req, res) => {
  try {
    const body = req.body || {};
    const {
      min,
      max,
      subjectId,
      grade,
      studentCommit,
      leafIndex,
      outDir,
      snarkBase,
      merklePublicationJson,
      merkleLeavesJson,
      singleLeafDemo,
    } = body;

    /** 默认由服务端 snarkCore（SNARK_BASE 环境变量或相对仓库的 zk_circuit）解析路径；仅本地开发可设 ZK_ALLOW_PATH_OVERRIDE=1 */
    const allowPathOverride = envFlag("ZK_ALLOW_PATH_OVERRIDE");
    const base = allowPathOverride && snarkBase ? String(snarkBase).trim() : undefined;
    const pubPath = allowPathOverride && merklePublicationJson ? String(merklePublicationJson).trim() : undefined;
    const leavesPath = allowPathOverride && merkleLeavesJson ? String(merkleLeavesJson).trim() : undefined;
    const demoLeaf =
      allowPathOverride && Boolean(singleLeafDemo) ? true : envFlag("ZK_SINGLE_LEAF_DEMO");

    const miss =
      min === undefined ||
      min === "" ||
      max === undefined ||
      max === "" ||
      subjectId === undefined ||
      subjectId === "" ||
      grade === undefined ||
      grade === "" ||
      !studentCommit ||
      leafIndex === undefined ||
      leafIndex === "";
    if (miss) {
      return res.status(400).json({ error: "缺少必填字段: min, max, subjectId, grade, studentCommit, leafIndex" });
    }

    assertGradeInRange(String(min), String(max), String(grade));
    const liNum = Number(leafIndex);
    const maxLeaf = (1 << MERKLE_LEVELS) - 1;
    if (!Number.isInteger(liNum) || liNum < 0 || liNum > maxLeaf) {
      return res.status(400).json({ error: `leafIndex 须为 0～${maxLeaf} 的整数` });
    }

    const out = outDir ? String(outDir).trim() : getDefaultOutputDirectorySync();

    const { publicationRecord, leaves, messages } = await resolvePublicationAndLeaves(
      leafIndex,
      {
        snarkBase: base,
        merklePublicationJson: pubPath,
        merkleLeavesJson: leavesPath,
        singleLeafDemo: demoLeaf,
      },
    );

    const result = await proveOnce({
      fields: {
        min: String(min),
        max: String(max),
        subjectId: String(subjectId),
        grade: String(grade),
        studentCommit: String(studentCommit),
        leafIndex: String(leafIndex),
      },
      publicationRecord,
      leaves,
      outDir: out,
      snarkBase: base,
    });

    res.json({
      ok: true,
      proofPath: result.proofPath,
      publicPath: result.publicPath,
      messages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    const body = req.body || {};
    const { outDir } = body;
    const out = outDir ? String(outDir).trim() : getDefaultOutputDirectorySync();

    const chain = await getChainVerifyStatus();
    if (!chain.chainVerifyReady) {
      return res.status(503).json({
        error: chain.chainVerifyHint,
        code: "CHAIN_NOT_READY",
      });
    }

    const result = await verifyOnChainGateway(out);

    res.json({
      ok: result.ok,
      publicSignals: result.publicSignals,
      labels: ["root", "min", "max", "subjectId"],
      via: result.via,
      gateway: result.gateway,
      hint: result.hint,
    });
  } catch (e) {
    const code = e.code;
    if (code === "CHAIN_NOT_CONFIGURED" || code === "DEPLOYED_JSON_MISSING" || code === "GATEWAY_MISSING") {
      return res.status(503).json({ error: e.message, code });
    }
    res.status(500).json({ error: e.message || String(e) });
  }
});

export async function startServer() {
  return new Promise((resolve) => {
    app.listen(PORT, "127.0.0.1", () => {
      if (process.env.ZK_VERBOSE === "1" || process.env.ZK_VERBOSE === "true") {
        console.error(`默认输出目录: ${getDefaultOutputDirectorySync()}`);
      }
      resolve();
    });
  });
}
