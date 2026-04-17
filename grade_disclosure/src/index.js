/**
 * 入口：启动本地 HTTP API（默认 127.0.0.1:3001）。
 * 带界面：npm run dev。证明本地生成；验证走链上合约（见 lib/chainVerify.js）。
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
