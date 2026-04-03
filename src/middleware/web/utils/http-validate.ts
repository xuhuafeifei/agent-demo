import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Validation result type.
 */
export type ValidateResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Create a middleware that validates request body against a TypeBox schema.
 * Returns validated data on success, or error message on failure.
 */
export function validateBody<T extends TSchema>(schema: T) {
  return function validate(req: any, res: any, next: any) {
    const body = req.body;
    
    if (body === undefined || body === null) {
      return next({
        success: false,
        error: "请求体不能为空",
      } as any);
    }
    
    const errors = [...Value.Errors(schema, body)];
    
    if (errors.length > 0) {
      const firstError = errors[0];
      const errorMessage = `字段 "${firstError.path}" 验证失败: ${firstError.message}`;
      
      return next({
        success: false,
        error: errorMessage,
      } as any);
    }
    
    // Attach validated data to request
    req.validatedBody = body as Static<T>;
    next();
  };
}

/**
 * Simple validation helper for routes that don't need middleware.
 * Returns validation result directly.
 */
export function validateRequestBody<T extends TSchema>(
  body: unknown,
  schema: T,
): ValidateResult<Static<T>> {
  if (body === undefined || body === null) {
    return {
      success: false,
      error: "请求体不能为空",
    };
  }
  
  const errors = [...Value.Errors(schema, body)];
  
  if (errors.length > 0) {
    const firstError = errors[0];
    const errorMessage = `字段 "${firstError.path}" 验证失败: ${firstError.message}`;
    
    return {
      success: false,
      error: errorMessage,
    };
  }
  
  return {
    success: true,
    data: body as Static<T>,
  };
}
