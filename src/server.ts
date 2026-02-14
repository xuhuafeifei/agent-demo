import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { logRuntimePaths } from "./agent/run";
import { createWebLayer } from "./middleware/web-layer";

// 加载环境变量
dotenv.config();

const app = express();
// 未设置 PORT 时使用 0，由系统分配一个可用端口
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;

// 静态文件目录：编译后 __dirname 为 dist/，页面在 src/public
const publicDir = path.join(__dirname, "..", "src", "public");

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.use("/api", createWebLayer());

function startServer(port: number) {
  const server = app.listen(port, () => {
    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr !== null && "port" in addr
        ? addr.port
        : port;

    console.log(`服务器正在运行在 http://localhost:${actualPort}`);
    console.log(`请在浏览器中打开 http://localhost:${actualPort} 查看应用`);
    console.log("注意：请在 .env 或 ~/.fgbg/fgbg.json 中配置可用模型 API Key");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port !== 0) {
      console.warn(`端口 ${port} 已被占用，正在改用随机可用端口...`);
      server.close(() => startServer(0));
      return;
    }

    console.error("服务器启动失败:", err.message);
    process.exit(1);
  });
}

async function bootstrap() {
  logRuntimePaths();
  startServer(PORT);
}

void bootstrap();
