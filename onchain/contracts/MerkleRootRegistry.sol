// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * 学校公示成绩 Merkle 根（与电路中 Poseidon 二叉树一致）。
 *
 * 说明：叶子哈希、路径验证在链下 / ZK 电路中完成；本合约只持久化「当前认可的根」，
 * 供监督方核对或与 ZK 公开信号 root 对照。链上逐层 Poseidon 验 Merkle 路径需另引 Poseidon 库，本示例不重复实现。
 */
contract MerkleRootRegistry {
    address public owner;

    /// @notice 当前公示根（BN254 标量域内，与 snarkjs publicSignals[0] 同语义）
    uint256 public merkleRoot;

    /// @notice 是否至少设置过一次根（便于网关拒绝未初始化状态）
    bool public rootInitialized;

    event MerkleRootUpdated(uint256 previousRoot, uint256 newRoot, address indexed updater);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setMerkleRoot(uint256 newRoot) external onlyOwner {
        uint256 prev = merkleRoot;
        merkleRoot = newRoot;
        rootInitialized = true;
        emit MerkleRootUpdated(prev, newRoot, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
