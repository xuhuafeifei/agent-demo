# Claude Code 用户偏好记忆存储方式分析

## 核心发现

### 存储方式：纯 Markdown 文件

Claude Code 的用户偏好记忆**不使用数据库索引**，而是使用纯 Markdown 文件存储：

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

### 检索方式：文件系统扫描 + 文本相似度匹配

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
    feedback: 0.3,     // 反馈记忆次之
    project: 0.25,    //   项目记忆
    reference: 0.1,   // 参考记忆最低
  }
  score += typeWeights[file.type] ?? 0.25

  // 内容相似度
  const contentSimilarity = calculateTextSimilarity(file.content, query)
  score += contentSimilarity * 0.6

  // 时间权重（最近的记忆更重要）
  const timeWeight = calculateTimeWeight(file.createdAt)
  score += timeWeight * 0.15

  return score
}
```

## 设计哲学

### "简单优先，渐进优化"

Claude Code 选择 Markdown 文件存储体现了这一核心设计哲学：

1. **简单性优先**
   - 不需要数据库、embedding、向量检索等复杂技术
   - 用户可以直接用文本编辑器修改
   - 不引入额外的依赖和复杂度

2. **渐进优化**
   - 当前实现：文件扫描 + 文本匹配 + 类型权重
   - 未来可以逐步升级：添加更智能的检索
   - 避免过度工程化

3. **场景适配**
   - 个人/团队协作场景：Markdown 文件更合适
   - 版本控制友好：git diff 清晰显示变更
   - 无需特殊工具：文本编辑器即可

## 与 agent-demo 的对比

| 维度 | Claude Code | agent-demo |
|------|------------|-------------|
| **存储方式** | Markdown 文件 | 向量检索 + SQLite |
| **索引文件** | MEMORY.md | 自动维护的索引表 |
| **检索方式** | 文本相似度 + 类型权重 | 向量相似度 + RRF |
| **文件数量** | 通常 < 20 个 | 可能数百个 |
| **更新方式** | 手动编辑 | 自动同步 + chunking |
| **检索性能** | 小规模快速 | 大规模高效 |

## Claude Code 方式的优势

### 1. 可维护性 ✅

**易于理解和编辑**
```bash
# 用户可以直接用文本编辑器修改
~/.claude/projects/my-project/memory/user/user_role.md

# Git 版本控制友好
git diff 显示清晰的变更历史
```

**无额外工具依赖**
- 不需要数据库管理工具
- 不需要 embedding 服务
- 不需要向量检索引擎

**审查友好**
- PR review 时可以清晰看到记忆变更
- git blame 可以追溯变更历史

### 2. 跨平台兼容 ✅

**通用格式**
- Markdown 是通用格式，跨平台兼容
- 任何文本编辑器都可以使用
- 便于团队协作和知识共享

**版本控制**
- Git 提供完整的版本历史
- 可以回滚到任意历史版本
- 便于比较和理解变更

### 3. 轻量级适用 ✅

**小规模高效**
- 对于 < 20 个记忆文件，文件扫描和文本匹配足够快
- 类型权重（user: 0.35, feedback: 0.3）确保相关记忆优先
- 时间权重（15%）确保新记忆不被旧记忆淹没

### 4. 用户控制 ✅

**完全自主**
- 用户完全控制记忆的内容和组织
- 不需要学习算法或推荐系统
- 用户可以直接删除、重命名、重新组织记忆

## Claude Code 方式的劣势

### 1. 检索精度有限 ⚠️

**文本匹配局限**
- 只能做简单的包含匹配
- 无法处理语义相似
- 无法处理同义词、概念关系

**类型权重固定**
- 类型权重是硬编码的（user: 0.35, feedback: 0.3）
- 无法根据实际使用情况动态调整

**无学习能力**
- 无法从用户行为中学习偏好
- 无法自动优化权重配置

### 2. 扩展性有限 ⚠️

**文件数量限制**
- MEMORY.md 限制在 200 行以内
- 索引超过限制会被截断
- 不适合存储大量记忆

**检索性能下降**
- 文件数量增长时，扫描和匹配性能下降
- 无法处理数百个记忆文件

### 3. 缺少高级功能 ⚠️

**无语义搜索**
- 无法进行语义相似度检索
- 无法处理同义词、概念关系
- 无法处理模糊查询

**无关系推理**
- 无法建立记忆之间的关联
- 无法进行知识图谱构建

**无自动维护**
- 无法自动清理过期记忆
- 无法自动合并重复记忆
- 无法自动检测冲突

## 适用场景分析

### Claude Code 方式适合

1. ✅ **个人项目**
   - 记忆数量少（< 20 个）
   - 用户频繁编辑记忆
   - 需要版本控制
   - 团队协作重要

2. ✅ **快速原型**
   - 快速迭代和实验
   - 不需要复杂功能
   - 用户完全控制

3. ✅ **文档友好**
   - 记忆本身就是文档
   - 便于分享和审查
   - Git diff 提供完整历史

### agent-demo 方式适合

1. ✅ **个人生活助手**
   - 需要语义搜索
   - 记忆数量可能较多
   - 需要长期积累

2. ✅ **大规模知识库**
   - 数百上千个记忆条目
   需要高效检索
   需要语义理解

3. ✅ **长期使用**
   - 需要自动维护
   - 需要学习能力
   - 需要复杂查询

## 设计权衡

### Claude Code 的权衡

**选择 Markdown 的原因**：
1. **简单性**：对于小规模项目，文件系统足够
2. **可维护性**：用户可以直接编辑，Git 提供版本控制
3. **无依赖**：不需要引入数据库、embedding 等复杂技术
4. **场景适配**：个人/团队协作场景更常见

**潜在问题**：
1. **检索精度**：只能做文本匹配，无法语义搜索
2. **扩展性**：文件数量限制在 200 行
3. **维护成本**：需要手动清理过期记忆

### agent-demo 的权衡

**选择向量检索的原因**：
1. **检索精度**：语义相似度 + RRF 融合检索
2. **扩展性**：可以处理数百个记忆
3. **自动化**：自动维护、清理、合并
4. **场景适配**：生活助手需要语义理解

**潜在问题**：
1. **复杂度**：引入了 SQLite、embedding、向量检索
2. **维护成本**：需要自动维护索引、embedding
3. **依赖**：需要 node-llama-cpp、sqlite-vec 等依赖

## 总结

### Claude Code：简单优先，渐进优化

**优势**：
- ✅ 简单、可维护、用户控制
- ✅ Git 版本控制友好
- ✅ 跨平台兼容
- ✅ 小规模高效

**劣势**：
- ⚠️ 检索精度有限（文本匹配）
- ⚠️ 扩展性有限（200 行限制）
- ⚠️ 维护成本高（手动清理）

### agent-demo：功能优先，技术驱动

**优势**：
- ✅ 语义检索精度高
- ✅ 扩展性强（可处理数百个记忆）
- ✅ 自动化程度高（自动维护、清理、合并）
- ✅ 检索性能高（向量检索）

**劣势**：
- ⚠️ 复杂度高（SQLite + embedding）
- ⚠️ 维护成本高（需要自动维护）
- ⚠️ 依赖多（node-llama-cpp、sqlite-vec）

## 建议

### 对于 agent-demo

**当前选择是正确的**：
- ✅ 向量检索 + SQLite 存储适合生活助手场景
- ✅ 语义理解对生活助手更重要
- ✅ 自动化程度高减少维护成本

**可以考虑的改进**：
1. 🎯 **保留向量检索**：这是核心优势
2. 🎯 **简化存储**：可以考虑用 Markdown 文件存储 embedding
3. 🎯 **优化检索**：添加更智能的检索策略
4. 🎯 **借鉴类型化设计**：学习 Claude Code 的类型权重思想

### 对于 Claude Code

**当前选择是正确的**：
- ✅ Markdown 存储适合其使用场景
- ✅ 简单、可维护、用户控制
- ✅ 可以渐进升级为更智能的检索

**可以考虑的改进**：
1. 🎯 **添加语义检索**：在文件扫描基础上添加语义匹配
2. 🎯 **优化权重系统**：动态调整类型权重
3. 🎯 **自动维护**：添加过期记忆清理、重复记忆合并

## 核心原则

**存储方式应该由场景决定**：
- 📯 个人/团队协作 → Markdown 文件（Claude Code）
- 📯 生活助手/大规模知识库 → 向量检索（agent-demo）
- 📯 混合方案 → 混合检索（向量 + 文本）

两个项目都选择了适合其使用场景的存储方式，这是正确的架构决策。
