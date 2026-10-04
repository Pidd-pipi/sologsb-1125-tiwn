# 陨石样本编目台（sologsb-1125 / gbmeteorite）

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21825>

停止（镜像保留）：

```bash
docker compose down
```

## 项目简介

面向陨石收藏者与标本室的纯前端单页应用：把样本、发现记录、切片制样与检测数值整理成本地可检索档案。
核心动作是登记样本与发现地坐标、挂接切片、录入电子探针数值并给出分类建议。

- 纯前端 SPA：**无后端、无数据库服务、无外部 API**
- 所有数据保存在浏览器本地：业务数据走 **IndexedDB（Dexie，库名 `gbmeteorite-db`）**，表单草稿走 **localStorage**
- 容器无状态，不挂载任何命名卷；换浏览器即换档案库

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6（`build` 脚本为 `tsc -b && vite build`，类型检查零错误） |
| UI 组件库 | MUI（@mui/material 6 + @mui/icons-material） |
| 状态管理 | Zustand（`sampleStore` 业务数据 / `uiStore` 筛选与提示） |
| 路由 | React Router 6（BrowserRouter + nginx `try_files` 兜底） |
| 本地存储 | Dexie 4（IndexedDB）+ localStorage（草稿） |
| 部署 | 多阶段 Dockerfile：node:20-alpine 构建 → nginx:alpine 托管 |

## 核心页面

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 样本总览：卡片流 + 分类/化学群/重量区间筛选与排序，缺坐标或缺切片显示角标 | MeteoriteSample |
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置，可补录发现地坐标并即时校验 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息与发现地就地编辑 + 切片列表 + 分析记录；按聚合修订号做乐观锁与字段冲突裁定 | 四个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量 | ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期
- 四张表自 v4 起都带 **`revision` 聚合修订号**（初版为 1），详见下方「并发编辑与修订号」

## 目录结构

```
sologsb-1125/
├── docker-compose.yml
├── .env / .env.example
├── README.md
└── frontend/
    ├── Dockerfile          # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf          # try_files + gzip
    ├── index.html
    ├── package.json
    ├── tsconfig*.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{sample,find,section,analysis}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v3 升级迁移
        ├── stores/{sampleStore,uiStore}.ts
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,AppShell,ConflictResolutionDialog}.tsx
        ├── hooks/{useSampleFilter,useSampleBundles,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Analysis,Locations}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo,revision}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 四张表补 `revision` 聚合修订号（乐观锁），旧数据一律回填初版修订号 `1`

## 并发编辑与修订号（乐观锁 + 字段级三方合并）

两个人同时打开同一样本（例如两个浏览器标签页）：一方整理分类 / 风化 / 存放位置，另一方补发现地 / 切片 / 检测数值。

- **按修订号一起检查四表**：详情保存时在一个 Dexie 事务内重读样本、发现记录、切片、检测记录（`sampleStore.saveBundleRevision`），把编辑基线 `BundleRevisions` 与库内当前版本逐表比对；任一部分修订号不同即判定版本落后
- **先列字段冲突，保留本次输入**：落后时不写入，按「base / 本次输入 / 对方新版本」做三方比对（`utils/revision.ts`），双方都改且取值不同的字段进入冲突清单（默认保留本次输入），仅对方修改的字段自动合并；由 `ConflictResolutionDialog` 逐项裁定
- **裁定完成才写入新版本**：携带裁定结果再次提交，事务内复查修订号（防止裁定期间又有更新），随后把样本、发现、切片、检测各自的修订号推进，样本簇修订号统一 +1
- **同一版本聚合**：详情、发现地分布（`useRegionStats`）与总览筛选（`useSampleFilter`）都消费同一份版本化档案簇聚合 `useSampleBundles`；任何写入后四张表原子刷新，聚合随之重算，不会继续显示旧汇总
- **跨标签页联动**：写入方通过 `BroadcastChannel('gbmeteorite-revision')` 通知其他标签页立即重读，切回标签页时再兜底重算一次；编辑期间检测到版本前进会显示提示条，且不抹掉本次输入
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理
- 首次打开会灌入 3 份演示样本、2 条发现记录、2 张切片与 2 条检测记录，便于直接体验筛选与打点

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
