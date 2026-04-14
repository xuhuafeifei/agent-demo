# Web Search Module - 架构设计文档

## 项目概述

本项目旨在复刻SearXNG的核心功能，实现一个简单但强大的元搜索引擎。我们将重点关注中国地区的搜索需求，提供高质量、无广告、隐私保护的搜索体验。

## 架构设计

### 整体架构

```mermaid
graph TD
    %% 用户界面层
    UI[Web UI] --> App[Flask应用]
    
    %% 应用层
    App --> SearchCore[SearchCore<br>核心搜索逻辑]
    App --> Engines[EngineIntegrations<br>搜索引擎集成]
    App --> Results[ResultProcessor<br>结果处理]
    
    %% 搜索引擎层
    Engines --> E1[Brave]
    Engines --> E2[DuckDuckGo]
    Engines --> E3[Qwant]
    Engines --> E4[Mojeek]
    Engines --> E5[Bing]
    Engines --> E6[Yahoo]
    
    %% 数据存储
    Results --> Cache[Cache<br>结果缓存]
    Results --> Storage[Storage<br>配置存储]
    
    %% 外部系统
    Storage --> Config[settings.yml<br>引擎配置]
    E1 --> External[外部API/网站]
    E2 --> External
    E3 --> External
    E4 --> External
    E5 --> External
    E6 --> External
    
    classDef ui fill:#e3f2fd,stroke:#2196f3
    classDef core fill:#f3e5f5,stroke:#9c27b0
    classDef engine fill:#fff3e0,stroke:#ff9800
    classDef data fill:#e8f5e9,stroke:#4caf50
    
    class UI ui
    class App core
    class SearchCore core
    class Engines core
    class Results core
    class E1,E2,E3,E4,E5,E6 engine
    class Cache,Storage,Config data
```

## 搜索引擎选择

### 引擎权重与类别

| 搜索引擎   | 通用搜索 | 图片搜索 | 新闻搜索 | 综合权重 |
| ---------- | -------- | -------- | -------- | -------- |
| Brave      | 1.5      | 1.5      | 1.5      | 1.5      |
| DuckDuckGo | 1.2      | 1.2      | 1.2      | 1.2      |
| Qwant      | 1.0      | 1.0      | 1.0      | 1.0      |
| Mojeek     | 0.8      | 0.8      | 0.8      | 0.8      |
| Bing       | 1.0      | 1.0      | 1.0      | 1.0      |

### 引擎配置表

| 引擎名称 | 权重 | 类别 | 状态 | 说明 |
|---------|------|------|------|------|
| **Brave** | 1.5 | general, images, news | 启用 | 优质结果，隐私保护 |
| **DuckDuckGo** | 1.2 | general, images, news | 启用 | 无广告，隐私第一 |
| **Qwant** | 1.0 | general, images, news | 启用 | 欧洲引擎，无追踪 |
| **Mojeek** | 0.8 | general | 启用 | 英国引擎，无广告 |
| **Bing** | 1.0 | general, images, videos | 启用 | 微软引擎，高质量结果 |
| **Yahoo** | 0.9 | general, news | 启用 | 聚合搜索 |

## 结果过滤策略

### 过滤流程

```mermaid
flowchart LR
    start[开始] --> A[接收结果]
    A --> B{URL验证}
    B -->|无效| C[丢弃]
    B -->|有效| D{关键词过滤}
    D -->|包含广告| C
    D -->|正常| E{广告检测}
    E -->|是广告| C
    E -->|不是| F{域名白名单}
    F -->|在黑名单| C
    F -->|正常| G[保留]
    
    C --> H[结束]
    G --> H
    
    style A fill:#e3f2fd
    style C fill:#ffcdd2
    style G fill:#c8e6c9
```

### 广告检测算法

```mermaid
graph LR
    Input[输入结果] --> URL[检查URL<br>广告模式]
    Input --> Title[检查标题<br>广告关键词]
    Input --> Content[检查内容<br>广告模式]
    
    URL --> R1{匹配模式}
    Title --> R2{包含关键词}
    Content --> R3{广告特征}
    
    R1 -->|是| D[标记为广告]
    R2 -->|是| D
    R3 -->|是| D
    
    R1 -->|否| K[保留]
    R2 -->|否| K
    R3 -->|否| K
    
    D --> Output[输出结果]
    K --> Output
    
    style D fill:#ffcdd2
    style K fill:#c8e6c9
```

## 结果合并去重

### 去重流程

```mermaid
flowchart TD
    start[开始] --> A[获取结果列表]
    A --> B[URL归一化]
    B --> C{检查是否已存在}
    C -->|已存在| D[合并信息]
    C -->|不存在| E[添加到结果集]
    
    D --> F[更新分数]
    E --> F
    
    F --> G{还有更多结果}
    G -->|是| A
    G -->|否| H[排序输出]
    
    style D fill:#fff3e0
```

### URL归一化

```mermaid
graph LR
    Input[原始URL] --> Parse[解析URL]
    Parse --> Normalize{标准化处理}
    
    Normalize --> Path[提取路径]
    Normalize --> Params[过滤参数]
    Normalize --> Scheme[统一协议]
    
    Params --> Filter[参数过滤<br>utm_*等]
    Params --> Sort[参数排序]
    
    Path --> Trim[去除尾随斜杠]
    
    Filter --> Combine[重构URL]
    Trim --> Combine
    Scheme --> Combine
    
    Combine --> Output[标准化URL]
```

## 评分与排序

### 评分算法

```mermaid
math
    score = engine_weight * (
        1.0 / position + 
        content_length / average_length + 
        thumbnail_bonus
    )
```

### 排序过程

```mermaid
flowchart LR
    start[开始] --> A[结果列表]
    A --> B[计算每个结果分数]
    
    B --> C{分数排序}
    C -->|降序| D[去重检查]
    D -->|重复| E[合并结果]
    D -->|唯一| F[保留]
    
    E --> G[更新分数]
    F --> G
    
    G --> H{分组显示}
    H -->|按引擎分组| I[分组显示]
    H -->|按类别分组| J[分组显示]
    
    I --> K[显示结果]
    J --> K
    
    style B fill:#e3f2fd
    style C fill:#fff3e0
    style K fill:#c8e6c9
```

## 并发搜索执行

### 多引擎搜索

```mermaid
sequenceDiagram
    participant UI as 用户界面
    participant App as Flask应用
    participant Core as SearchCore
    participant Engines as EnginePool
    
    UI->>App: 发送搜索请求
    App->>Core: 创建搜索任务
    
    rect rgb(191, 223, 255)
    Core->>Engines: 获取可用引擎
    Engines->>Core: 返回5个引擎
    end
    
    par 并行搜索
        Core->>E1: 搜索Brave
        Core->>E2: 搜索DuckDuckGo
        Core->>E3: 搜索Qwant
        Core->>E4: 搜索Mojeek
        Core->>E5: 搜索Bing
    end
    
    par 解析响应
        E1->>Core: 返回结果
        E2->>Core: 返回结果
        E3->>Core: 返回结果
        E4->>Core: 返回结果
        E5->>Core: 返回结果
    end
    
    rect rgb(200, 230, 200)
    Core->>Core: 结果处理
    Core->>Core: 过滤去重
    Core->>Core: 评分排序
    end
    
    Core->>App: 返回最终结果
    App->>UI: 显示结果
    
    Note over Core: 搜索引擎：Brave,DuckDuckGo,Qwant,Mojeek,Bing
    Note over Core: 执行时间：<5秒
```

## 架构组件

### SearchCore组件

```mermaid
classDiagram
    class SearchCore {
        +search(query, categories, limit)
        -get_engines_for_query()
        -execute_searches()
        -merge_results()
        -calculate_scores()
    }
    
    class SearchEngineManager {
        +get_active_engines()
        +get_engine_by_name()
        -load_config()
    }
    
    class EnginePool {
        +search_all()
        -create_engine_instance()
        -execute_parallel()
    }
    
    class SearchInterface {
        <<interface>>
        +search()
    }
    
    SearchCore *-- SearchEngineManager
    SearchCore *-- EnginePool
    SearchEngineManager *-- Engine
    EnginePool *-- Engine
    
    SearchInterface <|.. SearchCore
```

### EngineIntegrations组件

```mermaid
classDiagram
    class Engine {
        <<abstract>>
        +search()
        +parse_response()
        +get_query_params()
        #base_url
        #timeout
    }
    
    class BraveEngine {
        +search()
        +parse_response()
        +get_query_params()
    }
    
    class DuckDuckGoEngine {
        +search()
        +parse_response()
        +get_query_params()
    }
    
    class QwantEngine {
        +search()
        +parse_response()
        +get_query_params()
    }
    
    class MojeekEngine {
        +search()
        +parse_response()
        +get_query_params()
    }
    
    class BingEngine {
        +search()
        +parse_response()
        +get_query_params()
    }
    
    Engine <|-- BraveEngine
    Engine <|-- DuckDuckGoEngine
    Engine <|-- QwantEngine
    Engine <|-- MojeekEngine
    Engine <|-- BingEngine
    
    class EngineFactory {
        +create_engine()
        -engine_map
    }
    
    EngineFactory *-- Engine
```

### ResultProcessor组件

```mermaid
classDiagram
    class ResultProcessor {
        +deduplicate()
        +merge_duplicates()
        +calculate_scores()
        +filter_results()
    }
    
    class Deduplicator {
        +normalize_url()
        +hash_url()
        -filtered_params
    }
    
    class Scorer {
        +calculate_score()
        +engine_weight
        -position_weight
    }
    
    class Merger {
        +merge_two_results()
        +update_metadata()
    }
    
    class Filter {
        +filter_advertisements()
        +is_advertisement()
        +validate_url()
    }
    
    ResultProcessor *-- Deduplicator
    ResultProcessor *-- Scorer
    ResultProcessor *-- Merger
    ResultProcessor *-- Filter
    
    class SearchResult {
        +url
        +title
        +content
        +engine
        +score
        +positions
        +published_date
    }
    
    Deduplicator *-- SearchResult
    Scorer *-- SearchResult
    Merger *-- SearchResult
    Filter *-- SearchResult
```

## 数据流程

### 搜索请求流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as Web应用
    participant S as SearchCore
    participant E as 搜索引擎
    participant R as 结果处理
    
    U->>W: /search?q=查询&categories=general&limit=10
    
    rect rgb(191, 223, 255)
    W->>W: 参数验证
    W->>W: 查询解析
    end
    
    W->>S: 创建搜索接口
    
    rect rgb(255, 238, 170)
    S->>E: 获取引擎列表
    E->>E: 并发执行搜索
    end
    
    par 并行请求
        E->>E1: 请求Brave
        E->>E2: 请求DuckDuckGo
        E->>E3: 请求Qwant
        E->>E4: 请求Mojeek
        E->>E5: 请求Bing
    end
    
    par 响应解析
        E1->>E: 返回结果
        E2->>E: 返回结果
        E3->>E: 返回结果
        E4->>E: 返回结果
        E5->>E: 返回结果
    end
    
    rect rgb(200, 230, 200)
    E->>R: 结果处理
    R->>R: 过滤
    R->>R: 去重
    R->>R: 评分
    R->>R: 排序
    end
    
    R->>W: 返回处理后结果
    W->>U: 返回JSON响应
```

## 性能优化

### 连接池管理

```mermaid
stateDiagram-v2
    [*] --> idle: 初始化连接池
    idle --> active: 接收请求
    active --> used: 分配连接
    used --> active: 释放连接
    active --> idle: 空闲超时
    
    used --> error: 连接错误
    
    idle --> [*]: 关闭连接池
    
    state error {
        [*] --> Retry: 尝试重连
        Retry --> [*]: 重连成功
        Retry --> Failed: 重连失败
        Failed --> [*]: 报告错误
    }
    
    style idle fill:#c8e6c9
    style active fill:#e3f2fd
    style used fill:#fff3e0
    style error fill:#ffcdd2
```

### 响应缓存

```mermaid
flowchart LR
    Request[搜索请求] --> Check[检查缓存]
    Check -->|命中| Return[返回缓存结果]
    Check -->|未命中| Search[执行搜索]
    Search --> Process[处理结果]
    Process --> Save[保存到缓存]
    Save --> Return
    
    Return --> Response[返回响应]
    
    Check --> Expire{检查超时}
    Expire -->|过期| Search
    Expire -->|有效| Return
    
    style Return fill:#c8e6c9
    style Check fill:#e3f2fd
    style Search fill:#fff3e0
```

## 部署架构

### 生产部署

```mermaid
graph TD
    Internet[互联网用户] --> Load[负载均衡器<br>nginx]
    
    subgraph 应用服务器
        Load --> App1[Flask应用<br>服务器1]
        Load --> App2[Flask应用<br>服务器2]
        Load --> App3[Flask应用<br>服务器3]
        
        App1 --> Redis[Redis缓存]
        App2 --> Redis
        App3 --> Redis
        
        Redis --> Store[持久化存储<br>数据库]
    end
    
    subgraph 监控系统
        App1 --> Prom[Prometheus<br>监控]
        App2 --> Prom
        App3 --> Prom
        
        Prom --> Graf[Grafana<br>可视化]
    end
    
    style Internet fill:#e3f2fd
    style Load fill:#2196f3
    style App1,App2,App3 fill:#9c27b0
    style Redis fill:#4caf50
    style Store fill:#ff9800
    style Prom fill:#607d8b
```

## 技术栈

### 后端

```mermaid
pie title 后端技术分布
    "Flask" : 35
    "lxml" : 20
    "httpx" : 25
    "asyncio" : 10
    "其他" : 10
```

### 前端

```mermaid
pie title 前端技术分布
    "HTML5" : 30
    "CSS3" : 35
    "JavaScript" : 35
```

## 实现步骤

### 开发阶段

```mermaid
gantt
    title 开发时间表
    dateFormat  YYYY-MM-DD
    section 基础架构
    项目设置           :done,    p1, 2024-01-01, 2024-01-02
    核心组件开发       :active,  p2, 2024-01-02, 2024-01-05
    搜索引擎集成       :         p3, 2024-01-05, 2024-01-10
    
    section 功能实现
    搜索API开发        :         p4, 2024-01-10, 2024-01-15
    结果处理优化       :         p5, 2024-01-15, 2024-01-20
    前端界面开发       :         p6, 2024-01-20, 2024-01-25
    
    section 测试验证
    单元测试           :         p7, 2024-01-25, 2024-01-28
    集成测试           :         p8, 2024-01-28, 2024-01-30
    性能测试           :         p9, 2024-01-30, 2024-02-01
    
    section 部署上线
    生产环境部署       :         p10, 2024-02-01, 2024-02-02
    监控系统搭建       :         p11, 2024-02-02, 2024-02-05
```

## 总结

本架构设计实现了一个功能完整、性能良好的元搜索引擎，特别针对中国地区进行了优化。我们选择了高质量的搜索引擎，实现了有效的过滤和去重策略，并提供了直观的用户界面。这个实现保留了SearXNG的核心优势，同时简化了复杂度，适合在各种项目中集成使用。
