/**
 * 演示：学生数 × 门课数 条成绩，用与 circuit.circom 一致的 Poseidon(reference) 建树，
 * 多余叶子填 Poseidon(0,0,0)，输出 Merkle 根与 JSON。
 *
 * 用法:
 *   node tools/merkle_data.js
 *     无参数且为交互终端时进入菜单；否则用环境变量（适合 CI：加 --batch）
 *   node tools/merkle_data.js --students 10 --courses 10 [--shard-size N] [--write-leaves]
 *   node tools/merkle_data.js --batch
 *     仅用环境变量 STUDENTS、COURSES、MERKLE_SHARD_SIZE、WRITE_LEAVES_LAYER0
 *
 * 输出（默认分片）: merkle_publication.json + merkle_publication_shard_*.json；可选 leaves_layer0.json
 *
 * 约束: 学生数 ≤ 4000，课程数 ≤ 80；且 students × courses ≤ NUM_LEAVES（与 circuit 叶子容量一致）。
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { buildPoseidonReference } from "circomlibjs";
import {
  MERKLE_LEVELS,
  NUM_LEAVES,
  poseidon3Str,
  buildMerkleLevels,
  merkleProofFromLevels,
} from "./merkle_witness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "generated");

/** 公示 records 分片大小（条数）；证明端按 leafIndex 只打开一个分片 */
const DEFAULT_SHARD_SIZE = 5000;

/** 业务上允许的单维上限（与 Merkle 叶子容量无关；乘积仍须 ≤ NUM_LEAVES） */
const MAX_STUDENTS = 4000;
const MAX_COURSES = 80;

const DEFAULT_COURSE_NAMES = [
  "高等数学",
  "大学英语",
  "数据结构",
  "操作系统",
  "线性代数",
  "概率论",
  "数据库",
  "计算机网络",
  "软件工程",
  "职业规划",
];

function courseNameFor(courseIdx) {
  if (courseIdx < DEFAULT_COURSE_NAMES.length) {
    return DEFAULT_COURSE_NAMES[courseIdx];
  }
  return `课程${courseIdx + 1}`;
}

function printHelp() {
  console.log(`用法: node tools/merkle_data.js [选项]

无参数: 在交互终端下进入菜单；非 TTY（如 CI）则用环境变量，等同 --batch

选项:
  -h, --help
  --batch              不显示菜单，仅使用环境变量（STUDENTS、COURSES、MERKLE_SHARD_SIZE、WRITE_LEAVES_LAYER0）
  --students N         与菜单/环境变量等价，默认 10
  --courses M
  --shard-size N       每片条数，默认 5000
  --write-leaves         生成 leaves_layer0.json

环境变量: STUDENTS、COURSES、MERKLE_SHARD_SIZE、WRITE_LEAVES_LAYER0=1

约束: 学生 1～${MAX_STUDENTS}，课程 1～${MAX_COURSES}，students×courses ≤ ${NUM_LEAVES}`);
}

/**
 * @param {object} raw
 * @param {number} raw.students
 * @param {number} raw.courses
 * @param {number} raw.shardSize
 * @param {boolean} raw.writeLeavesLayer0
 */
function validateDims(raw) {
  const { students, courses, shardSize, writeLeavesLayer0 } = raw;

  if (!Number.isInteger(shardSize) || shardSize < 1) {
    throw new Error("MERKLE_SHARD_SIZE / 分片大小须为正整数");
  }
  if (!Number.isInteger(students) || students < 1) {
    throw new Error("学生数须为正整数");
  }
  if (!Number.isInteger(courses) || courses < 1) {
    throw new Error("课程数须为正整数");
  }
  if (students > MAX_STUDENTS) {
    throw new Error(`学生数不能超过 ${MAX_STUDENTS}（当前 ${students}）`);
  }
  if (courses > MAX_COURSES) {
    throw new Error(`课程数不能超过 ${MAX_COURSES}（当前 ${courses}）`);
  }

  const total = students * courses;
  if (total > NUM_LEAVES) {
    throw new Error(
      `students×courses=${total} 超过叶子容量 ${NUM_LEAVES}（请先增大电路 MERKLE_LEVELS 或减少规模）`,
    );
  }

  return { students, courses, total, shardSize, writeLeavesLayer0 };
}

function parseDimsFromEnv() {
  const students = Number(process.env.STUDENTS ?? 10);
  const courses = Number(process.env.COURSES ?? 10);
  const shardSize = Number.parseInt(
    process.env.MERKLE_SHARD_SIZE ?? String(DEFAULT_SHARD_SIZE),
    10,
  );
  const writeLeavesLayer0 = process.env.WRITE_LEAVES_LAYER0 === "1";
  return validateDims({ students, courses, shardSize, writeLeavesLayer0 });
}

function parseDimsFromArgv(argv) {
  let students = Number(process.env.STUDENTS ?? 10);
  let courses = Number(process.env.COURSES ?? 10);
  let shardSize = Number.parseInt(
    process.env.MERKLE_SHARD_SIZE ?? String(DEFAULT_SHARD_SIZE),
    10,
  );
  let writeLeavesLayer0 =
    argv.includes("--write-leaves") || process.env.WRITE_LEAVES_LAYER0 === "1";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--students" || a === "--student") && argv[i + 1]) {
      students = parseInt(argv[++i], 10);
    } else if ((a === "--courses" || a === "--course") && argv[i + 1]) {
      courses = parseInt(argv[++i], 10);
    } else if ((a === "--shard-size" || a === "--shardSize") && argv[i + 1]) {
      shardSize = parseInt(argv[++i], 10);
    }
  }

  return validateDims({ students, courses, shardSize, writeLeavesLayer0 });
}

function parseYesNo(line, defaultBool) {
  const t = line.trim().toLowerCase();
  if (t === "") return defaultBool;
  if (t === "y" || t === "yes" || t === "1" || t === "是") return true;
  if (t === "n" || t === "no" || t === "0" || t === "否") return false;
  return defaultBool;
}

async function promptInt(rl, label, defaultVal, min, max) {
  for (;;) {
    const line = (await rl.question(`${label} [默认 ${defaultVal}，范围 ${min}～${max}]: `)).trim();
    const n = line === "" ? defaultVal : parseInt(line, 10);
    if (!Number.isInteger(n) || n < min || n > max) {
      console.log(`请输入 ${min}～${max} 的整数，或直接回车使用默认值。`);
      continue;
    }
    return n;
  }
}

async function interactiveMainMenu() {
  const rl = readline.createInterface({ input, output });

  const defStudents = Number(process.env.STUDENTS ?? 10);
  const defCourses = Number(process.env.COURSES ?? 10);
  const defShard = Number.parseInt(
    process.env.MERKLE_SHARD_SIZE ?? String(DEFAULT_SHARD_SIZE),
    10,
  );
  const defWriteLeaves = process.env.WRITE_LEAVES_LAYER0 === "1";

  try {
    console.log("\n========== 学校 Merkle 公示数据生成 ==========");
    console.log(`电路: 深度 ${MERKLE_LEVELS}，叶子槽位 ${NUM_LEAVES}；学生 ≤${MAX_STUDENTS}，课程 ≤${MAX_COURSES}`);
    console.log("环境变量可作为默认值：STUDENTS、COURSES、MERKLE_SHARD_SIZE、WRITE_LEAVES_LAYER0\n");
    console.log("  1 — 小演示：10×10，分片 5000，不写 leaves_layer0");
    console.log(`  2 — 中等：100×${MAX_COURSES}（课程数取上限），分片 5000，不写 leaves`);
    console.log("  3 — 满量程：4000×80，分片 5000，不写 leaves");
    console.log("  4 — 自定义（学生数、课程数、分片大小、是否写 leaves）");
    console.log("  0 — 退出\n");

    const choice = (await rl.question("请输入序号 [0-4]: ")).trim();

    if (choice === "0") {
      console.log("已取消。");
      process.exit(0);
    }

    if (choice === "1") {
      return validateDims({
        students: 10,
        courses: 10,
        shardSize: DEFAULT_SHARD_SIZE,
        writeLeavesLayer0: false,
      });
    }

    if (choice === "2") {
      return validateDims({
        students: 100,
        courses: MAX_COURSES,
        shardSize: DEFAULT_SHARD_SIZE,
        writeLeavesLayer0: false,
      });
    }

    if (choice === "3") {
      return validateDims({
        students: MAX_STUDENTS,
        courses: MAX_COURSES,
        shardSize: DEFAULT_SHARD_SIZE,
        writeLeavesLayer0: false,
      });
    }

    if (choice === "4") {
      const students = await promptInt(rl, "学生数", defStudents, 1, MAX_STUDENTS);
      const courses = await promptInt(rl, "每名学生课程数", defCourses, 1, MAX_COURSES);
      const prod = students * courses;
      if (prod > NUM_LEAVES) {
        throw new Error(`students×courses=${prod} 超过叶子容量 ${NUM_LEAVES}`);
      }
      const shardSize = await promptInt(
        rl,
        "每片记录条数（shard-size）",
        defShard,
        1,
        Math.max(1, prod),
      );
      const wlLine = await rl.question(
        `是否生成 leaves_layer0.json（整树 ${NUM_LEAVES} 叶，体积大）？y/N [默认 ${defWriteLeaves ? "Y" : "N"}]: `,
      );
      const writeLeavesLayer0 = parseYesNo(wlLine, defWriteLeaves);
      return validateDims({ students, courses, shardSize, writeLeavesLayer0 });
    }

    throw new Error("无效序号，请重新运行脚本。");
  } finally {
    rl.close();
  }
}

async function resolveDims(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes("--batch")) {
    return parseDimsFromEnv();
  }

  const cliFlags = new Set([
    "--students",
    "--student",
    "--courses",
    "--course",
    "--shard-size",
    "--shardSize",
    "--write-leaves",
  ]);
  const hasCliArgs = argv.some((a) => cliFlags.has(a));

  if (hasCliArgs) {
    return parseDimsFromArgv(argv);
  }

  if (input.isTTY) {
    return interactiveMainMenu();
  }

  return parseDimsFromEnv();
}

/** 可复现的伪随机分数 60–100（与索引相关） */
function gradeFor(studentIdx, courseIdx) {
  const seed = (studentIdx + 1) * 131 + (courseIdx + 1) * 17;
  return String(60 + (seed % 41));
}

async function runDatasetGeneration(opts) {
  const {
    students: STUDENTS,
    courses: COURSES,
    total: RECORD_TOTAL,
    shardSize: SHARD_SIZE,
    writeLeavesLayer0,
  } = opts;

  console.error(
    `[1/6] 规模 ${STUDENTS}×${COURSES}=${RECORD_TOTAL} 条；底层叶子槽位 ${NUM_LEAVES}（深度 ${MERKLE_LEVELS}）`,
  );

  console.error("[2/6] 初始化 Poseidon(reference)…");
  const poseidon = await buildPoseidonReference();
  const F = poseidon.F;
  const zeroLeaf = poseidon3Str(poseidon, F, "0", "0", "0");

  function studentCommitFor(studentIdx) {
    return String(8000000001 + studentIdx);
  }

  function subjectIdFor(courseIdx) {
    return String(101 + courseIdx);
  }

  const records = [];
  const leaves = Array(NUM_LEAVES).fill(zeroLeaf);

  console.error(`[3/6] 生成 ${RECORD_TOTAL} 条成绩叶子…`);
  const labelPad = Math.max(2, String(STUDENTS).length);
  for (let s = 0; s < STUDENTS; s++) {
    const studentCommit = studentCommitFor(s);
    const studentLabel = `STU2026${String(s + 1).padStart(labelPad, "0")}`;
    for (let c = 0; c < COURSES; c++) {
      const leafIndex = s * COURSES + c;
      const subjectId = subjectIdFor(c);
      const grade = gradeFor(s, c);
      const leafHash = poseidon3Str(poseidon, F, studentCommit, grade, subjectId);
      leaves[leafIndex] = leafHash;
      records.push({
        leafIndex,
        studentLabel,
        studentIndex: s,
        studentCommit,
        courseIndex: c,
        courseName: courseNameFor(c),
        subjectId,
        grade,
        leafHash,
      });
    }
  }

  console.error(
    `[4/6] 自底向上建树并求根（对 ${NUM_LEAVES} 片叶子做 ${MERKLE_LEVELS} 层 Poseidon，可能需数分钟；与旧版相比不再对同一棵树做第二次完整归约）…`,
  );
  const levels = buildMerkleLevels(poseidon, F, leaves);
  const merkleRoot = levels[MERKLE_LEVELS][0];

  console.error(
    `[5/6] 为每条成绩记录附加 Merkle 路径（共 ${records.length} 条，供证明时跳过整树 Poseidon）…`,
  );
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const p = merkleProofFromLevels(levels, r.leafIndex);
    r.pathElements = p.pathElements;
    r.pathIndices = p.pathIndices;
    if (p.root !== merkleRoot) {
      throw new Error(`内部校验失败: leafIndex=${r.leafIndex} 路径根与 merkleRoot 不一致`);
    }
    if (i > 0 && i % 50000 === 0) {
      console.error(`      已附加 ${i}/${records.length} 条…`);
    }
  }

  const publication = {
    generatedAt: new Date().toISOString(),
    poseidon: "circomlibjs buildPoseidonReference(与 circom Poseidon 一致)",
    leafSchema: "Poseidon(studentCommit, grade, subjectId)",
    dimensions: { students: STUDENTS, courses: COURSES },
    merkleLevels: MERKLE_LEVELS,
    numLeaves: NUM_LEAVES,
    paddingLeaf: zeroLeaf,
    ...(RECORD_TOTAL < NUM_LEAVES
      ? { paddingRange: { from: RECORD_TOTAL, to: NUM_LEAVES - 1 } }
      : { paddingRange: null, note: "叶子已用尽，无 padding" }),
    recordCount: records.length,
    merkleRoot,
    publicationFormat: "sharded",
    shardSize: SHARD_SIZE,
    shardCount: Math.ceil(RECORD_TOTAL / SHARD_SIZE) || 0,
    shardFilePattern: "merkle_publication_shard_{index}.json",
    storageNote: writeLeavesLayer0
      ? `已生成 leaves_layer0.json（完整 ${NUM_LEAVES} 片叶子，体积大）。`
      : `公示已分片（每片最多 ${SHARD_SIZE} 条）；证明只读 merkle_publication.json + 对应 merkle_publication_shard_*.json。未生成 leaves_layer0.json（默认）；菜单选项 4 可勾选生成整叶文件。`,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });

  const shardCount = Math.ceil(RECORD_TOTAL / SHARD_SIZE) || 0;

  console.error(
    `[6/6] 写入公示（分片 ${shardCount} 个文件 + 元数据 merkle_publication.json；共 ${records.length} 条；leaves_layer0 ${
      writeLeavesLayer0 ? `含 ${NUM_LEAVES} 叶` : "跳过（默认）"
    }）…`,
  );

  const metaCompact = JSON.stringify(publication);
  await fs.writeFile(path.join(OUT_DIR, "merkle_publication.json"), metaCompact, "utf8");
  console.error("      已写入 merkle_publication.json（仅元数据，无 records）");

  for (let s = 0; s < shardCount; s++) {
    const from = s * SHARD_SIZE;
    const slice = records.slice(from, from + SHARD_SIZE);
    const shard = {
      shardIndex: s,
      leafIndexFrom: slice[0].leafIndex,
      leafIndexTo: slice[slice.length - 1].leafIndex,
      recordCount: slice.length,
      records: slice,
    };
    const shardName = `merkle_publication_shard_${s}.json`;
    await fs.writeFile(path.join(OUT_DIR, shardName), JSON.stringify(shard), "utf8");
    if (s === 0 || s === shardCount - 1 || (s + 1) % 20 === 0) {
      console.error(`      已写入 ${shardName}（${slice.length} 条）`);
    }
  }
  if (shardCount > 1) {
    console.error(`      … 共 ${shardCount} 个分片文件`);
  }

  const r0 = records[0];
  if (!r0.pathElements || !r0.pathIndices) {
    throw new Error("内部错误: records[0] 缺少 pathElements/pathIndices");
  }

  if (writeLeavesLayer0) {
    const leavesComment =
      RECORD_TOTAL < NUM_LEAVES
        ? `第 0 层 ${NUM_LEAVES} 个叶子，索引 0–${RECORD_TOTAL - 1} 为成绩记录，${RECORD_TOTAL}–${
            NUM_LEAVES - 1
          } 为 padding`
        : `第 0 层 ${NUM_LEAVES} 个叶子已全部为成绩记录（无 padding）`;

    console.error(`      正在序列化并写入 leaves_layer0.json（${NUM_LEAVES} 个叶子，体积大）…`);
    await fs.writeFile(
      path.join(OUT_DIR, "leaves_layer0.json"),
      JSON.stringify(
        {
          comment: leavesComment,
          merkleRoot,
          leaves,
        },
        null,
        0,
      ),
      "utf8",
    );
    console.error("      已写入 leaves_layer0.json（紧凑格式）");
  } else {
    console.error("      已跳过 leaves_layer0.json（菜单选项 4 可开启）");
  }

  const sampleInput = {
    comment: `leafIndex=0（${r0.studentLabel} / ${r0.courseName}）的 snarkjs 输入示例；路径与分片公示同批建树一致（见 merkle_publication_shard_0.json）`,
    root: merkleRoot,
    min: "60",
    max: "100",
    subjectId: r0.subjectId,
    grade: r0.grade,
    studentCommit: r0.studentCommit,
    pathElements: r0.pathElements,
    pathIndices: r0.pathIndices,
  };
  await fs.writeFile(
    path.join(OUT_DIR, "sample_proof_input_leaf0.json"),
    JSON.stringify(sampleInput, null, 2),
    "utf8",
  );
  console.error("      已写入 sample_proof_input_leaf0.json");

  console.log("完成。输出目录:", OUT_DIR);
  console.log(`规模: ${STUDENTS} 名学生 × ${COURSES} 门课 = ${RECORD_TOTAL} 条记录`);
  console.log("Merkle 根 (merkleRoot):", merkleRoot);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = await resolveDims(argv);
  await runDatasetGeneration(opts);
}

const thisFile = path.resolve(fileURLToPath(import.meta.url));
const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry && thisFile === entry) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

export { validateDims, parseDimsFromEnv, parseDimsFromArgv, runDatasetGeneration };
