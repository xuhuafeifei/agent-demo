import fs from "node:fs";
const lines = fs.readFileSync("/root/github/agent-demo/src/middleware/weixin/weixin-ilink.ts", "utf8").split("\n");
for (let i = 160; i < 175; i++) {
  console.log((i + 1) + ": " + lines[i]);
}
