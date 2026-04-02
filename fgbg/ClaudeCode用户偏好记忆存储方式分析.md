# Claude Code 用户偏好记忆存储方式分析

## 核心发现

### Claude Code 使用纯 Markdown 文件存储！

**不是数据库索引，而是基于文件系统的记忆管理**。

## 存储架构

### 目录结构

```
~/.claude/projects/<project-slug>/memory/
├── MEMORY.md              # 记忆入口点（索引文件）
├── user/                 # 用户记忆
│   ├── user_role.md
│   ├── user_preferences.md
│   └── ...
├── feedback/             # 反馈记忆
│   ├── feedback_testing.md
│   └── ...
├── project/              # 项目记忆
│   ├── project_auth_rewrite.md
│   └── ...
└── reference/            # 参考记忆
    ├── error_tracking.md
    └── ...
```

### 文件格式

```markdown
---
name: user_role
description: 用户角色和技能信息
type: user
---

用户是一位拥有 10 年 Go 语言经验的资深后端工程师，但对 React 前端开发不熟悉。
在解释前端概念时，应使用后端类比。
```

## 检索机制

### 文件系统扫描

```typescript
// src/memdir/findRelevantMemories.ts
export function findRelevantMemories(
  query: string,
  memoryFiles: MemoryFile[],
): MemoryFile[] {
  // 1. 文本相似度匹配
  const textMatches = memoryFiles.filter(file =>
    file.content.toLowerCase().includes(query.toLowerCase())
  )

  // 2. 类型权重调整
  const weightedMatches = textMatches.map(file => ({
    ...file,
    score: calculateMemoryScore(file, query),
  }))

  // 3. 按分数排序
  const sortedMatches = weightedMatches.sort((a, b) => b.score - a.score)

  // 4. 返回前 N 个匹配项
  return sortedMatches.slice(0, MAX_RELEVANT_MEMORIES)
}

function calculateMemoryScore(file: MemoryFile, query: string): number {
  let score = 0

  // 类型权重
  const typeWeights = {
    user: 0.35,      // 用户记忆权重最高
    feedback: 0.3,    // 反馈记忆次之
    project: 0.25,   // 项目记忆
    reference: 0.1,  // 参考记忆最低
  }
  score += typeWeights[file[file.type] ?? 0.25

  // 内容相似度
  const contentSimilarity = calculateTextSimilarity(file.content, query)
  score += contentSimilarity * 0.6  // 60% 权重

  // 时间权重（最近的记忆更重要）
  const timeWeight = calculateTimeWeight(file.createdAt)
  score += timeWeight * 0.15  // 15% 权重

  return score
}
```

### 权重公式

```
总分 = 类型权重(35%) + 内容相似度(60%) + 时间权重(15%)
```

## 设计哲学

### "简单优先，渐进优化"

Claude Code 选择 Markdown 文件存储体现了这一核心哲学：

1. **简单性优先**
   - 不需要数据库、embedding、向量检索等复杂技术
   - 用户可以直接用文本编辑器修改
   - 不引入额外的依赖和复杂度

2. **渐进优化**
   - 当前实现：文件扫描 + 文本匹配 + 类型权重
   - 未来可以逐步升级：添加更智能的匹配、语义搜索等
   - 避免过度工程化

3. **场景适配**
   - 个人/团队协作场景：Markdown 文件更合适
   - 用户频繁编辑记忆：Git diff 清晰显示变更
   - 版本控制友好：git blame 追溯变更历史

## 与 agent-demo 的对比

| 维度 | Claude Code | agent-demo |
|------|------------|-------------|
| **存储方式** | Markdown 文件 | SQLite + 向量检索 |
| **索引文件** | MEMORY.md | 自动维护的索引表 |
| **检索方式** | 文本相似度 + 类型权重 | 向量相似度 + RRF |
| **文件数量** | 通常 < 20 个 | 可能数百个 |
| **更新方式** | 手动编辑 | 自动同步 + chunking |
| **检索性能** | 小规模快速 | 大规模高效 |

## 优势分析

### Markdown 文件存储的优势

1. **易于理解和编辑** ✅
```bash
# 用户可以直接编辑
~/.claude/projects/my-project/memory/user/user_role.md

# Git 版本控制友好
git diff user_role.md
```

2. **版本控制友好** ✅
```bash
# 完整的变更历史
git log --oneline --graph --decorate user_role.md

# 可以回滚到任意历史版本
git blame user_role.md
```

3. **跨平台兼容** ✅
- Markdown 是通用格式
- 任何文本编辑器都可以使用
- 便于团队协作和知识共享

4. **无额外依赖** ✅
- 不需要数据库服务
- 不需要 embedding 模型
- 不需要向量检索引擎

5. **用户完全控制** ✅
- 用户决定记忆的内容和结构
- 用户可以随时删除或重命名文件
- 不需要学习算法的"黑盒"

### Markdown 文件存储的劣势

1. **检索精度有限** ⚠️
- 只能做简单的文本包含匹配
- 无法处理语义相似（同义词、概念关系）
- 无法处理模糊查询

2. **扩展性有限** ⚠️
- MEMORY.md 限制在 200 行
- 文件数量增长时性能下降
- 不适合大规模知识库

3. **无学习能力** ⚠️
- 无法从用户行为中自动学习
- 无法自动优化权重配置
- 无法自动清理过期记忆

## 向量检索的优势（agent-demo）

1. **语义相似度** ✅
- 可以理解"用户偏好"和"用户喜欢"的语义相似
- 可以处理同义词、概念关系
- 可以处理模糊查询

2. **扩展性强** ✅
- 可以处理数百个记忆文件
- 性能随文件数量线性增长

3. **自动化程度高** ✅
- 自动 embedding 计算
- 自动同步和索引
- 自动清理过期记忆

## 向量检索的劣势

1. **复杂度高** �ra️
- 需要 SQLite、node-llama-cpp、sqlite-vec 等依赖
- 需要 embedding 模型或服务
- 维护成本高

2. **用户控制度低** ⚠️
- 用户无法直接编辑向量数据库
- 用户难以理解 embedding 结果
- 修改记忆需要通过工具或脚本

3. **可观测性差** ⚠️
- 难以调试检索结果
- 难以理解权重计算过程

## 适用场景分析

### Markdown 文件存储适合

1. ✅ **用户偏好记忆**（Claude Code 当前使用）
   - 数量相对较少（< 20 个）
   - 用户频繁编辑
   - 需要版本控制
   - 文本匹配已经足够

2. ✅ **团队协作项目**
   - PR review 需要查看记忆变更
   - Git diff 清晰显示变更历史
   - 跨平台兼容

3. ✅ **快速原型开发**
   - 不需要复杂的数据库设置
   - 快速迭代记忆内容
   - 用户完全控制

### 向量检索适合

1. ✅ **大规模知识库**（agent-demo 当前使用）
   - 数百上千个记忆条目
   - 需要语义搜索能力
   - 需要高性能检索

2. ✅ **个人知识助手**
   - 需要理解用户偏好和习惯
   - 需要处理模糊查询
   - 长期积累大量记忆

3. ✅ **语义搜索需求**
   - 需要处理同义词、概念关系
   - 需要处理模糊查询
- 需要智能推荐

## 混合方案建议

### 对于 agent-demo

**当前选择**：向量检索 + SQLite 存储
- ✅ 适合生活助手场景
- ✅ 语义搜索能力强
- ✅ 自动化程度高
- ✅ 适合长期积累

**可以考虑的改进**：
1. **添加 Markdown 文件作为补充数据源**
   - 向量检索主要处理语义相似
   - Markdown 文件提供精确的用户偏好
   - 混合检索：向量 + 文本

2. **借鉴类型化设计**
   ```typescript
   interface Memory {
     type: 'preference' | 'context' | 'reference' | 'schedule'
     content: string
     timestamp: number
     metadata?: Record<string, unknown>
   }
   ```

3. **借鉴权重系统**
   ```typescript
   const typeWeights = {
     preference: 0.35,  // 用户偏好权重最高
     context: 0.25,     // 上下文记忆
     reference: 0.1,   // 参考记忆
     schedule: 0.3,    // 调度记忆
   }
   ```

### 对于 Claude Code

**当前选择**：Markdown 文件存储
- ✅ 适合用户偏好记忆
- ✅ 适合团队协作场景
- ✅ 简单、可维护

**可以考虑的改进**：
1. **添加向量检索作为补充**
   - 对于大规模知识库使用向量检索
   - 用户偏好仍然用 Markdown 存储
   - 混合检索：向量 + 文本

2. **改进匹配算法**
   - 从简单文本匹配升级为语义匹配
   - 处理同义词、概念关系
   - 使用 embedding 计算语义相似度

3. **扩展文件限制**
   - 从 200 行限制逐步增加
- 根据实际性能调整限制
- 添加文件大小限制

## 总结

### Claude Code 的选择是正确的

**对于用户偏好记忆**，Markdown 文件存储是合理的选择**：

1. ✅ **简单性优先**：用户可以直接编辑
2. ✅ **版本控制友好**：Git diff 和 git blame 提供完整历史
3. ✅ **跨平台兼容**：Markdown 是通用格式
4. ✅ **用户完全控制**：用户决定记忆的内容和组织
5. ✅ **场景适配**：用户偏好数量少、编辑频繁、需要版本控制

**核心哲学**："简单优先，渐进优化"
- 从简单的文件扫描和文本匹配开始
- 根据实际需求逐步添加更智能的功能
- 避免过度工程化，保持用户友好性

### agent-demo 的选择也是正确的

**对于生活助手场景，向量检索是合理的选择**：

1. ✅ **语义搜索能力**：理解用户偏好和习惯
2. ✅ **扩展性强**：可以处理大量记忆
3. ✅ **自动化程度高**：自动 embedding 和同步
4. ✅ **场景适配**：生活助手需要语义理解和长期积累

**核心哲学**："功能优先，技术驱动"
- 选择最适合场景的技术方案
- 不盲目追求"更先进"的技术
- 根据实际需求优化用户体验

两个项目都选择了适合其使用场景的存储方式，这是正确的架构决策。
