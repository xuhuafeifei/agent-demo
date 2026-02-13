#!/usr/bin/env python3
"""
最小 DeepSeek 控制台对话 demo（无 pi-core）。
- 直接 HTTP POST 到 DeepSeek OpenAI 兼容接口
- 打印首包耗时（TTFB）和总耗时
- 支持连续对话（本地内存保存 history）
"""

import json
import os
import time
import urllib.request
from pathlib import Path

FGBG_CONFIG = Path.home() / ".fgbg" / "fgbg.json"


def load_config():
    cfg = {}
    if FGBG_CONFIG.exists():
        try:
            cfg = json.loads(FGBG_CONFIG.read_text("utf-8"))
        except Exception:
            cfg = {}

    providers = (((cfg.get("models") or {}).get("providers") or {}))
    deepseek = providers.get("deepseek") or {}

    api_key = os.getenv("DEEPSEEK_API_KEY") or deepseek.get("apiKey") or ""
    base_url = (deepseek.get("baseUrl") or "https://api.deepseek.com").rstrip("/")
    model = ((deepseek.get("models") or [{}])[0].get("id") or "deepseek-chat")

    return {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
    }


def call_deepseek(base_url, api_key, model, messages, timeout=90):
    url = f"{base_url}/chat/completions"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "stream": False,
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        first_byte_at = time.perf_counter()  # 拿到响应头/首字节的时间点
        raw = resp.read()                    # 读取完整响应
    end = time.perf_counter()

    ttfb_ms = (first_byte_at - start) * 1000
    total_ms = (end - start) * 1000

    data = json.loads(raw.decode("utf-8"))
    text = data["choices"][0]["message"]["content"]

    return text, ttfb_ms, total_ms


def main():
    cfg = load_config()
    api_key = cfg["api_key"]
    base_url = cfg["base_url"]
    model = cfg["model"]

    if not api_key:
        print("缺少 API Key。请设置 DEEPSEEK_API_KEY，或在 ~/.fgbg/fgbg.json 中配置 deepseek.apiKey")
        return

    print("DeepSeek 直连测试（无 pi-core）")
    print(f"base_url={base_url}")
    print(f"model={model}")
    print("输入 exit 退出。\n")

    messages = [{"role": "system", "content": "你是一个简洁的助手。"}]

    while True:
        user = input("你: ").strip()
        if not user:
            continue
        if user.lower() in {"exit", "quit", "q"}:
            break

        messages.append({"role": "user", "content": user})

        try:
            answer, ttfb_ms, total_ms = call_deepseek(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
            )
            print(f"\nAI: {answer}\n")
            print(f"[timing] ttfb_ms={ttfb_ms:.0f} total_ms={total_ms:.0f}\n")
            messages.append({"role": "assistant", "content": answer})
        except Exception as e:
            print(f"请求失败: {e}\n")


if __name__ == "__main__":
    main()
