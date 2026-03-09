#!/usr/bin/env node
/**
 * Standalone Qwen Portal device OAuth. Writes credentials to ~/.fgbg/qwen-oauth.json.
 * Usage: npm run qwen-auth  or  node dist/scripts/qwen-oauth-login.js
 */

import { resolveQwenPortalOAuth } from "../agent/auth/qwen-portal-oauth.js";

resolveQwenPortalOAuth()
  .then(() => {
    console.log("Qwen OAuth 登录成功，凭证已保存到 ~/.fgbg/qwen-oauth.json");
    process.exit(0);
  })
  .catch((err: Error) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });