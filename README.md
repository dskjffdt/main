# 零知识成绩披露（zk_grade）

Groth16 电路 + 本地证明服务 + Hardhat 链上验证（GradeZkGateway / MerkleRootRegistry）。

## 目录说明

| 目录 | 说明 |
|------|------|
| `zk_circuit/` | Circom 电路、snarkjs 脚本与公示数据生成 |
| `grade_disclosure/` | Node 本地 API + `client/` 前端 |
| `onchain/` | Hardhat 合约与部署脚本 |

## 环境变量

- `grade_disclosure/.env.example` → 复制为 `grade_disclosure/.env`
- `onchain/.env.example` → 复制为 `onchain/.env`

**切勿将 `.env` 提交到 Git**（已在 `.gitignore` 中忽略）。

## 本地依赖（概览）

各子目录分别执行 `npm install`，并按各目录 `package.json` 的脚本编译电路、部署合约、启动前后端。

## 推送到 GitHub

在仓库根目录 `zk_grade/`：

```bash
git init
git add .
git status
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

若 GitHub 上已创建空仓库，按页面提示使用 HTTPS 或 SSH 地址替换 `origin`。
