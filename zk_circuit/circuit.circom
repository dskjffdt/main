pragma circom 2.0.0;

// ZK + Merkle（Poseidon）：叶子 = Poseidon(studentCommit, grade, subjectId)，公开 root/min/max/subjectId
include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/comparators.circom";

// 二叉 Merkle 层数：最多 2^LEVELS 条叶子；与 tools/merkle_witness.js、index.js 中常量一致
template GradeMerklePoseidon(LEVELS) {
    signal input root;
    signal input min;
    signal input max;
    signal input subjectId;

    signal input grade;
    signal input studentCommit;
    signal input pathElements[LEVELS];
    signal input pathIndices[LEVELS];

    for (var i = 0; i < LEVELS; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
    }

    component leafH = Poseidon(3);
    leafH.inputs[0] <== studentCommit;
    leafH.inputs[1] <== grade;
    leafH.inputs[2] <== subjectId;

    component hashers[LEVELS];
    signal levelOut[LEVELS + 1];
    signal left[LEVELS];
    signal right[LEVELS];
    levelOut[0] <== leafH.out;

    // 二元选择：idx=0 时 current 在左；idx=1 时在右（仅用一次乘法，避免非二次项）
    for (var i = 0; i < LEVELS; i++) {
        left[i] <== levelOut[i] + pathIndices[i] * (pathElements[i] - levelOut[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (levelOut[i] - pathElements[i]);

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        levelOut[i + 1] <== hashers[i].out;
    }

    levelOut[LEVELS] === root;

    component cMin = LessEqThan(16);
    cMin.in[0] <== min;
    cMin.in[1] <== grade;
    cMin.out === 1;

    component cMax = LessEqThan(16);
    cMax.in[0] <== grade;
    cMax.in[1] <== max;
    cMax.out === 1;
}

// 19 层 → 2^19=524288 叶子 ≥ 4000×80；与 merkle_witness MERKLE_LEVELS 一致
component main { public [ root, min, max, subjectId ] } = GradeMerklePoseidon(19);
