/**
 * Hook 基类：子类实现 onEvent，可选覆盖 priority（默认 100，数值越小越先执行）。
 */
export abstract class BaseHook<T = unknown> {
  abstract readonly name: string;

  priority(): number {
    return 100;
  }

  abstract onEvent(event: T): void | Promise<void>;
}
