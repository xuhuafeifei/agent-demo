import { z } from "zod";

/**
 * 日志配置校验 Schema
 */
export const loggingConfigSchema = z.object({
  level: z.enum(
    ["trace", "debug", "info", "warn", "error", "fatal", "silent"],
    {
      message: "日志等级必须是 trace/debug/info/warn/error/fatal/silent 之一",
    },
  ),
  cacheTimeSecond: z.number().int().min(60).max(300, {
    message: "缓存时间必须是 60-300 之间的整数",
  }),
  file: z.string().min(1, { message: "日志文件路径不能为空" }),
  consoleLevel: z.enum(["debug", "info", "warn", "error", "fatal", "silent"], {
    message: "控制台日志等级必须是 debug/info/warn/error/fatal/silent 之一",
  }),
  consoleStyle: z.enum(["pretty", "common", "json"], {
    message: "控制台输出样式必须是 pretty/common/json 之一",
  }),
  allowModule: z.array(z.string()).optional().default([]),
});

/**
 * 从 loggingConfigSchema 推导 TypeScript 类型
 */
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

/**
 * 模型提供商配置校验 Schema
 */
export const modelProviderSchema = z.object({
  baseUrl: z.string().url({ message: "Base URL 必须是有效的 URL" }).optional(),
  apiKey: z.string().optional(),
  api: z
    .enum(["openai-completions", "openai-chat", "anthropic", "custom"])
    .optional(),
  models: z
    .array(
      z.object({
        id: z.string().min(1, { message: "模型 ID 不能为空" }),
        name: z.string().optional(),
      }),
    )
    .optional(),
  enabled: z.boolean().optional(),
  auth: z.enum(["oauth", "api-key"]).optional(),
});

/**
 * 记忆检索配置校验 Schema
 */
export const memorySearchConfigSchema = z.object({
  mode: z.enum(["local", "remote"], {
    message: "模式必须是 local 或 remote",
  }),
  model: z.string().optional(),
  endpoint: z.string().url({ message: "Endpoint 必须是有效的 URL" }).optional(),
  apiKey: z.string().optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  chunkMaxChars: z
    .number()
    .int()
    .min(1, {
      message: "chunk 最大字符数必须大于 0",
    })
    .optional(),
  download: z
    .object({
      enabled: z.boolean().optional(),
      url: z.string().url({ message: "下载地址必须是有效的 URL" }).optional(),
      timeout: z
        .number()
        .int()
        .min(1000, {
          message: "下载超时必须大于等于 1000ms",
        })
        .optional(),
    })
    .optional(),
});

/**
 * 心跳配置校验 Schema
 */
export const heartbeatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMs: z
    .number()
    .int()
    .min(200)
    .max(60000, {
      message: "心跳间隔必须是 200-60000 之间的整数",
    })
    .optional(),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(3, {
      message: "并发数必须是 1-3 之间的整数",
    })
    .optional(),
  allowedScripts: z.array(z.string()).optional().default([]),
});

/**
 * QQBot 渠道配置校验 Schema
 */
/** PATCH：appId/clientSecret 允许空字符串，表示不修改（密钥在 ~/.fgbg/qq/） */
export const qqbotChannelSchema = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().nullish(),
  /** deepDiff 对「相对 base 缺失的键」会填 null；GET 展示里也可能是 null */
  clientSecret: z.string().nullish(),
  /** GET 拼出来的展示字段，不参与写盘，仅允许出现在 PATCH 里 */
  hasCredentials: z.boolean().nullish(),
  /** 运行时由 ~/.fgbg/qq/accounts.json 维护；前端可能回传 null，不参与业务校验 */
  targetOpenid: z.string().nullish(),
  accounts: z.array(z.string()).optional().default([]),
});

/** 微信通道：仅开关写入 fgbg，凭证在 ~/.fgbg/weixin/ */
export const weixinChannelSchema = z.object({
  enabled: z.boolean().optional(),
});

/**
 * 测试连接请求校验 Schema
 */
export const testConnectionRequestSchema = z.object({
  baseUrl: z.url({ message: "Base URL 必须是有效的 URL" }),
  apiKey: z.string().optional(),
  model: z.string().min(1, { message: "模型名称不能为空" }),
  providerId: z.string().optional(),
  qwenCredentialType: z
    .enum(["oauth", "api_key"], {
      message: "qwenCredentialType不能为空",
    })
    .optional(),
});

/**
 * 记忆检索测试请求校验 Schema
 */
export const memorySearchTestRequestSchema = z.object({
  memorySearch: z
    .object({
      mode: z.enum(["local", "remote"]).optional(),
      model: z.string().optional(),
      endpoint: z.string().url().optional(),
      apiKey: z.string().optional(),
      embeddingDimensions: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * 校验辅助函数
 */
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): {
  success: boolean;
  data?: T;
  error?: string;
} {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  // 格式化错误信息
  const errorMessages = result.error.issues
    .map((err: any) => {
      const path = err.path.join(".");
      return `${path}: ${err.message}`;
    })
    .join("; ");

  return { success: false, error: errorMessages };
}

/**
 * Express 中间件：校验请求体
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: any, res: any, next: any) => {
    const result = validateRequest(schema, req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Express 中间件：校验查询参数
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: any, res: any, next: any) => {
    const result = validateRequest(schema, req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}
