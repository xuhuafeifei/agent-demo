# fgbg.json 配置说明

本文说明 Agent Demo 中全局用户配置文件 `fgbg.json` 的路径、优先级和字段。

## 1. 配置文件路径

- 默认路径：`~/.fgbg/fgbg.json`
- 覆盖路径：设置环境变量 `FGBG_CONFIG_PATH=/your/path/fgbg.json`

代码入口：

- 路径解析：`src/agent/agent-path.ts`
- 配置读取与合并：`src/agent/model-config.ts`

## 2. 配置优先级

同字段按以下优先级覆盖（从高到低）：

1. 环境变量（如 `MINIMAX_API_KEY`）
2. 项目配置 `config/model.json`
3. 全局配置 `fgbg.json`
4. 代码默认值

说明：

- `model-config.ts` 会先合并“全局 + 项目”，再在 API Key 解析时让环境变量覆盖。

## 3. 字段结构

推荐结构如下（与 OpenClaw 风格一致，只保留模型相关字段）：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "apiKey": "sk-api-xxx",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "MiniMax-M2.1",
            "contextWindow": 200000
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "minimax/MiniMax-M2.1"
      }
    }
  }
}
```

字段说明：

- `models.providers.<provider>.apiKey`: 对应 provider 的 key
- `agents.defaults.model.primary`: 默认模型（重点字段）
- `models.providers.<provider>.models[].contextWindow`: 可作为上下文窗口来源

兼容说明：

- 仍兼容旧扁平结构 `{ model, apiKey }`，但建议统一使用上面这种结构。

## 4. 当前支持的隐式 provider

- `minimax`
- `moonshot`
- `kimi-code`
- `qwen-portal`
- `xiaomi`
- `ollama`（默认加入，通常本地无 key 也可用）

## 5. 示例：全局 + 项目覆盖

场景：

- 全局 `~/.fgbg/fgbg.json` 设置默认 `minimax`
- 项目 `config/model.json` 把 `model.provider` 改成 `moonshot`

结果：

- 运行时默认 provider 为 `moonshot`（项目覆盖全局）
- 如果设置了 `MOONSHOT_API_KEY`，优先使用环境变量中的 key
