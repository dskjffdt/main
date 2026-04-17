/**
 * 使用 circomlibjs 的 buildPoseidonReference（与 circom / circomlib 电路一致；勿用 wasm opt 版，否则哈希与电路不一致）
 * 叶子 = Poseidon(studentCommit, grade, subjectId)
 * 二叉 Merkle 深度 MERKLE_LEVELS，空位用 Poseidon(0,0,0) 填充。
 *
 * 运行: node tools/merkle_witness.js
 */

import path from "path";
import { fileURLToPath } from "url";
import { buildPoseidonReference } from "circomlibjs";

// 与 circuit.circom 中 GradeMerklePoseidon(LEVELS) 一致；19 → 2^19 片叶子
export const MERKLE_LEVELS = 19;
export const NUM_LEAVES = 1 << MERKLE_LEVELS;

export function poseidon3Str(poseidon, F, a, b, c) {
  const h = poseidon([String(a), String(b), String(c)]);
  return F.toString(h);
}

export function poseidon2Str(poseidon, F, a, b) {
  const h = poseidon([String(a), String(b)]);
  return F.toString(h);
}

/**
 * 自底向上建满二叉 Merkle 各层（levels[0] 为叶子，levels[MERKLE_LEVELS] 为根，长度 1）。
 * 与 {@link computeMerkleRootFromLeaves} 哈希量相同，但保留各层便于多次取路径而不再重复整树归约。
 */
export function buildMerkleLevels(poseidon, F, leaves) {
  if (leaves.length !== NUM_LEAVES) {
    throw new Error(`需 ${NUM_LEAVES} 个叶子，当前 ${leaves.length}`);
  }
  let level = [...leaves];
  const levels = [level];
  for (let layer = 0; layer < MERKLE_LEVELS; layer++) {
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      next.push(poseidon2Str(poseidon, F, level[j], level[j + 1]));
    }
    level = next;
    levels.push(level);
  }
  return levels;
}

/**
 * 在已建好的 {@link buildMerkleLevels} 结果上取某叶子的路径与根（仅 O(MERKLE_LEVELS) 次查表）。
 */
export function merkleProofFromLevels(levels, leafIndex) {
  let idx = leafIndex;
  const pathElements = [];
  const pathIndices = [];
  for (let i = 0; i < MERKLE_LEVELS; i++) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(levels[i][siblingIdx]);
    pathIndices.push(idx % 2);
    idx = (idx / 2) | 0;
  }
  return {
    root: levels[MERKLE_LEVELS][0],
    pathElements,
    pathIndices,
  };
}

/**
 * 自底向上校验：叶子 Poseidon 串沿 path 是否与 expectedRoot 一致（与 circuit.circom 左右选择一致）。
 */
export function verifyMerklePath(poseidon, F, leafStr, pathElements, pathIndices, expectedRoot) {
  if (
    pathElements.length !== MERKLE_LEVELS ||
    pathIndices.length !== MERKLE_LEVELS
  ) {
    return false;
  }
  let cur = leafStr;
  for (let i = 0; i < MERKLE_LEVELS; i++) {
    const pi = Number(pathIndices[i]);
    const sib = pathElements[i];
    let left;
    let right;
    if (pi === 0) {
      left = cur;
      right = sib;
    } else {
      left = sib;
      right = cur;
    }
    cur = poseidon2Str(poseidon, F, left, right);
  }
  return cur === expectedRoot;
}

/**
 * 给定完整底层叶子数组（长度 2^MERKLE_LEVELS），求某下标的 Merkle 路径与根。
 * 多叶真实树必须用此函数；仅有单条记录时可用 {@link buildMerkleProof}。
 */
export function buildMerkleProofFromLeaves(poseidon, F, leaves, leafIndex) {
  if (leaves.length !== NUM_LEAVES) {
    throw new Error(`需 ${NUM_LEAVES} 个叶子，当前 ${leaves.length}`);
  }
  let level = [...leaves];
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;

  for (let i = 0; i < MERKLE_LEVELS; i++) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(level[siblingIdx]);
    pathIndices.push(idx % 2);

    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      next.push(poseidon2Str(poseidon, F, level[j], level[j + 1]));
    }
    idx = (idx / 2) | 0;
    level = next;
  }

  return { root: level[0], pathElements, pathIndices };
}

/** 仅一片叶子非零、其余为 Poseidon(0,0,0) 时的路径（演示单条记录） */
export function buildMerkleProof(poseidon, F, leafStr, leafIndex) {
  const zeroLeaf = poseidon3Str(poseidon, F, "0", "0", "0");
  const leaves = Array(NUM_LEAVES).fill(zeroLeaf);
  leaves[leafIndex] = leafStr;
  return buildMerkleProofFromLeaves(poseidon, F, leaves, leafIndex);
}

/**
 * 给定满二叉树底层 2^MERKLE_LEVELS 个叶子（十进制字段串），自底向上求 Merkle 根（与电路一致）。
 */
export function computeMerkleRootFromLeaves(poseidon, F, leaves) {
  if (leaves.length !== NUM_LEAVES) {
    throw new Error(`需 ${NUM_LEAVES} 个叶子，当前 ${leaves.length}`);
  }
  let level = [...leaves];
  for (let layer = 0; layer < MERKLE_LEVELS; layer++) {
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      next.push(poseidon2Str(poseidon, F, level[j], level[j + 1]));
    }
    level = next;
  }
  return level[0];
}

/**
 * 供 grade_disclosure 服务端调用：同一套 Poseidon/Merkle 与电路一致。
 *
 * @param {object} fields — min, max, subjectId, grade, studentCommit, leafIndex
 * @param {object} [options]
 * @param {object} [options.publicationRecord] — 来自 merkle_publication 顶层 merkleRoot + 单条 record（含 pathElements/pathIndices/leafHash/leafIndex）。
 *        若提供则只做 O(LEVELS) 次 Poseidon 校验，不加载整棵 leaves_layer0（生成数据时需为每条 record 写入路径）。
 * @param {string[]} [options.leaves] — 长度须为 NUM_LEAVES；无 publicationRecord 时按完整树建路径（与 merkle_publication / leaves_layer0.json 一致）。
 *        不提供时沿用旧行为：仅一片叶子非零、其余为 Poseidon(0,0,0)（根与学校公示树不一致，仅作单机演示）。
 */
export async function buildWitnessInputFromFields(fields, options = {}) {
  const poseidon = await buildPoseidonReference();
  const F = poseidon.F;
  const {
    min,
    max,
    subjectId,
    grade,
    studentCommit,
    leafIndex = 0,
  } = fields;

  const leafStr = poseidon3Str(poseidon, F, studentCommit, grade, subjectId);
  const li = Number(leafIndex) || 0;
  const pub = options.publicationRecord;
  const fullLeaves = options.leaves;

  let root;
  let pathElements;
  let pathIndices;

  if (
    pub &&
    Array.isArray(pub.pathElements) &&
    pub.pathElements.length === MERKLE_LEVELS &&
    Array.isArray(pub.pathIndices) &&
    pub.pathIndices.length === MERKLE_LEVELS &&
    pub.merkleRoot !== undefined
  ) {
    if (Number(pub.leafIndex) !== li) {
      throw new Error(
        `叶子下标不一致: merkle_publication 中该条 leafIndex=${pub.leafIndex}，当前填写 leafIndex=${li}`,
      );
    }
    if (pub.leafHash !== undefined && pub.leafHash !== leafStr) {
      throw new Error(
        `叶子与公示不一致: 该条 record 的 leafHash 与 Poseidon(studentCommit,grade,subjectId)=${leafStr} 不符，请按公示填写三项私密输入。`,
      );
    }
    if (
      !verifyMerklePath(
        poseidon,
        F,
        leafStr,
        pub.pathElements,
        pub.pathIndices,
        pub.merkleRoot,
      )
    ) {
      throw new Error(
        "Merkle 路径与 merkleRoot 不一致（可能 merkle_publication 与当前电路/数据不匹配）。",
      );
    }
    root = pub.merkleRoot;
    pathElements = pub.pathElements;
    pathIndices = pub.pathIndices;
  } else if (fullLeaves && fullLeaves.length === NUM_LEAVES) {
    if (fullLeaves[li] !== leafStr) {
      throw new Error(
        `叶子与公示不一致:leafIndex=${li} 处树叶为 ${fullLeaves[li]}，而 Poseidon(studentCommit,grade,subjectId)=${leafStr}。请按 merkle_publication 中该下标的 studentCommit、grade、subjectId 填写。`,
      );
    }
    ({ root, pathElements, pathIndices } = buildMerkleProofFromLeaves(
      poseidon,
      F,
      fullLeaves,
      li,
    ));
  } else if (fullLeaves) {
    throw new Error(`leaves 须为长度 ${NUM_LEAVES} 的数组`);
  } else {
    ({ root, pathElements, pathIndices } = buildMerkleProof(
      poseidon,
      F,
      leafStr,
      li,
    ));
  }

  return {
    root,
    min: String(min),
    max: String(max),
    subjectId: String(subjectId),
    grade: String(grade),
    studentCommit: String(studentCommit),
    pathElements,
    pathIndices,
  };
}

async function main() {
  const studentCommit = process.env.STUDENT_COMMIT || "12345";
  const grade = process.env.GRADE || "85";
  const subjectId = process.env.SUBJECT_ID || "1001";
  const min = process.env.MIN || "60";
  const max = process.env.MAX || "100";
  const leafIndex = Number(process.env.LEAF_INDEX || "0");

  const input = await buildWitnessInputFromFields({
    min,
    max,
    subjectId,
    grade,
    studentCommit,
    leafIndex,
  });

  console.log(JSON.stringify(input, null, 2));
}

const thisFile = path.resolve(fileURLToPath(import.meta.url));
const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && thisFile === entry) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
