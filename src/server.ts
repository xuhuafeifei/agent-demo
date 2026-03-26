import express from "express";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import { logRuntimePaths } from "./agent/run.js";
import { createWebLayer } from "./middleware/web/web-layer.js";
import { fileURLToPath } from "node:url";
import { getMemoryIndexManager } from "./memory/index.js";
import {
  ensureLoggingSetting,
  getSubsystemConsoleLogger,
} from "./logger/logger.js";
import { startWatchDog } from "./watch-dog/watch-dog.js";
import { startQQLayer } from "./middleware/qq/qq-layer.js";

// 加载环境变量
dotenv.config();

const app = express();
// 固定监听 localhost；未设置 PORT 时默认 6727，被占用则改用随机端口
const HOST = "localhost";
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 6727;

// 静态文件目录：编译后 __dirname 为 dist/，页面在 src/public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "src", "public");
const serverLogger = getSubsystemConsoleLogger("server");

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.use("/api", createWebLayer());

function startServer(port: number) {
  const isDefaultPort = port === PORT;
  serverLogger.info(
    `尝试监听端口 ${port}${isDefaultPort && process.env.PORT ? "（来自环境变量 PORT）" : isDefaultPort ? "（默认）" : "（随机，因默认端口被占用）"}`,
  );
  const server = http.createServer(app);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port !== 0) {
      serverLogger.warn(`端口 ${port} 已被占用，正在改用随机可用端口...`);
      server.close(() => startServer(0));
      return;
    }

    serverLogger.error("服务器启动失败: %s", err.message);
    process.exit(1);
  });

  server.on("listening", () => {
    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr !== null && "port" in addr
        ? addr.port
        : port;

    serverLogger.info(
      `服务器正在运行在 http://localhost:${actualPort}（进程 PID: ${process.pid}）`,
    );
  });

  server.listen(port, HOST);
}

async function bootstrap() {
  ensureLoggingSetting();
  logRuntimePaths();
  try {
    await getMemoryIndexManager().start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverLogger.error("[memory] disabled: %s", message);
  }
  try {
    // 启动心跳调度：定时扫描 task_schedule 表并分发任务
    await startWatchDog();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverLogger.error("[watch-dog] failed to start: %s", message);
  }
  try {
    await startQQLayer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverLogger.error("[qq-layer] failed to start: %s", message);
  }
  startServer(PORT);
}

void bootstrap();
