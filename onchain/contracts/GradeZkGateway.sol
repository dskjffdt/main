// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Groth16Verifier.sol";
import "./MerkleRootRegistry.sol";

/**
 * 将 Groth16 验证与公示 Merkle 根绑定：公开信号顺序为
 * [ root, min, max, subjectId ]（与 circuit.circom 一致）。
 */
contract GradeZkGateway {
    Groth16Verifier public immutable verifier;
    MerkleRootRegistry public immutable registry;

    constructor(address _verifier, address _registry) {
        verifier = Groth16Verifier(_verifier);
        registry = MerkleRootRegistry(_registry);
    }

    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[4] calldata _pubSignals
    ) external view returns (bool) {
        if (!registry.rootInitialized()) return false;
        if (_pubSignals[0] != registry.merkleRoot()) return false;
        return verifier.verifyProof(_pA, _pB, _pC, _pubSignals);
    }
}
