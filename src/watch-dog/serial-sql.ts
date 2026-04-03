import { watchDogLogger } from "./watch-dog.js";

// type Task<T> = () => Promise<T>;

// export const createSerialExecutor = () => {
//   let queue: Task<any>[] = [];
//   let running = false;

//   const run = async (): Promise<void> => {
//     if (running) return;
//     running = true;

//     while (queue.length > 0) {
//       const task = queue.shift()!;
//       try {
//         await task();
//       } catch (err) {
//         // 理论上不会到这里，但防止 executor 崩掉
//         watchDogLogger.error("serial executor task error:", err);
//       }
//     }

//     running = false;
//   };

//   const execute = <T>(task: Task<T>): Promise<T> => {
//     return new Promise((resolve, reject) => {
//       queue.push(async () => {
//         try {
//           const result = await task();
//           resolve(result);
//         } catch (err) {
//           reject(err);
//         }
//       });
//       void run();
//     });
//   };

//   return { execute };
// };

/*
// 使用
const executor = createSerialExecutor();

// tickOnce 中
const result = await executor.execute(async () => {
  // 多条 SQL
  return data;
});
*/

type Task<T> = () => Promise<T>;

export const createSerialExecutor = () => {
  let chain: Promise<unknown> = Promise.resolve();

  const execute = <T>(task: Task<T>): Promise<T> => {
    const result = chain.then(task);
    chain = result.catch(() => {});
    return result;
  };

  return { execute };
};
