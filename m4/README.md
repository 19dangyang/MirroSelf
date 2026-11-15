# M4 · 匹配池服务端

> 只做两件事：**候选召回** 与 **同意信箱**。
> 它不保存任何作品 ID、标题、观看时间、UP 主列表，也不存明文联系方式。

---

## 1. 它能做什么

**它是纯 API，不提供任何网页。** 打开域名只会看到一段 JSON。用户全程待在浏览器插件里，
只在「匹配池」里填一次域名。

```
浏览器插件                        这台服务                       另一个人的插件
    │  上传名片 + 公钥 + PoW  ───▶  存 token/名片/公钥            │
    │                             建倒排桶（分区 / 标签 / 标签对）  │
    │  ◀── /match 只回几个公钥 ───  服务器算好排序                  │
    │  点"想认识"，用对方公钥加密 ─▶ 只存密文，读不懂 ───────────▶ │
    │                             双方都同意后各自取回对方密文       │
    │  ◀── 本机解密出联系方式 ───                                │
```

**服务端拿不到的**：作品明细、真实身份、明文联系方式、相似度分数。
**服务端能拿到的**：一张量化名片（分区/标签分布 + 质量分）、一个公钥、一个匿名 token、
一封密文，以及"谁想认识谁"这个定向元数据（这一点是协议本身决定的，不粉饰）。

---

## 2. 部署（三种方式，任选其一）

**共用前提**：需要一个 **Upstash Redis**（免费层 1 万命令/天）当存储。
所有平台都是无状态的，不接 KV 的话冷启动后数据全丢。

在 <https://console.upstash.com> 建一个 Redis，记下两个值：**REST URL** 和 **REST Token**。
区域选香港或新加坡。

---

### 方式 A：Cloudflare Workers（推荐，10 万请求/天）

免费额度最大、**没有冷启动**、不需要信用卡。

仓库根目录有一个 `wrangler.toml`（`main = "m4/worker.js"`），所以 Cloudflare 的
「从 Git 仓库创建 Worker」在**仓库根**执行 `npx wrangler deploy` 也能找到配置。

#### A-1：从网页创建（不用装任何东西）

1. Cloudflare 控制台 → **Workers & Pages** → **创建** → **Workers** →
   **从 Git 仓库导入**
2. 选你的仓库，项目名填 `mirroself-api`
3. 构建命令**留空**，部署命令保持 `npx wrangler deploy`（默认值就行）
4. 点部署

> ⚠️ 这一步只完成一半。**Git 部署不会执行 `wrangler secret put`**，
> 环境变量必须在创建完之后去控制台加（见 A-2）。没加之前 `/api/v1/health`
> 会返回 `"storage":"memory"`，数据一刷新就丢。

#### A-2：添加两个机密变量（必做）

Workers 控制台 → 你的 Worker → **设置** → **变量和机密** → **添加**

| 名称 | 类型 | 值 |
|---|---|---|
| `KV_REST_API_URL` | **机密** | Upstash 的 REST URL |
| `KV_REST_API_TOKEN` | **机密** | Upstash 的 REST Token |

加完点 **部署 / 保存**，然后访问：

```
https://mirroself-api.<你的子域>.workers.dev/api/v1/health
→ { "ok": true, "at": ..., "storage": "kv" }
```

**`storage` 必须是 `kv`。** 是 `memory` 就说明变量没生效。

#### A-3：命令行部署（可选）

```bash
npx wrangler login
npx wrangler secret put KV_REST_API_URL
npx wrangler secret put KV_REST_API_TOKEN
npx wrangler deploy            # 在仓库根执行
```

> Workers 上没有 `process.env`、也没有 `node:crypto`。`worker.js` 和 `lib/pow.js`
> 已经改成只用 WebCrypto + `env` 参数，所以同一份业务代码能同时跑在 Node 和 Workers 上。
> `m4/tests/runtime.test.mjs` 会静态扫描依赖链，防止有人再引入 `node:` 或裸用 `process`。

**本地调试 Workers**：`npx wrangler dev`

---

### 方式 B：Render 免费 Web Service（不改一行代码）

`dev-server.mjs` 本身就是一个标准 Node HTTP 服务，Render 可以直接跑。

1. 新建 **Web Service** → 连 GitHub 仓库
2. **Root Directory** 填 `m4`
3. Build Command 留空，Start Command 填 `node dev-server.mjs`
4. Environment 加 `KV_REST_API_URL` / `KV_REST_API_TOKEN`
5. 免费实例**闲置 15 分钟会休眠**，下次请求要等 30–50 秒唤醒

适合自己用；给朋友用会觉得"卡"。

---

### 方式 C：自己电脑 + Cloudflare Tunnel（零成本，但机器要开着）

```bash
cd m4
node dev-server.mjs                       # 本地 8790
cloudflared tunnel --url http://127.0.0.1:8790
```

cloudflared 会给你一个 `https://xxx.trycloudflare.com` 地址，插件里填它即可。
关上电脑服务就没了，只适合自己临时用。

---

### 方式 D：Vercel（如果你能用）

1. 导入仓库，**Root Directory 选 `m4`**，Framework 选 Other
2. Environment Variables 加 `KV_REST_API_URL` / `KV_REST_API_TOKEN`
3. Deploy

`vercel.json` 已配好，区域固定在 `hkg1`（Hobby 不支持多区域）。

---

### 三种方式的选择

| 方式 | 免费额度 | 冷启动 | 需要信用卡 | 上手 |
|---|---|---|---|---|
| **Cloudflare Workers** | 10 万请求/天 | 无 | 否 | 一条命令 |
| Render | 750 小时/月 | 有（30–50s） | 否 | 网页点几下 |
| 自己的电脑 + Tunnel | 无限 | 无（但电脑要开） | 否 | 两条命令 |

**给朋友用选 A，自己测选 C。**

---

## 3. 本地跑

```bash
cd m4
node dev-server.mjs            # http://127.0.0.1:8790/api/v1/health
```

没有环境变量时自动用内存存储，重启即丢，只适合联调。

```bash
node --test "tests/*.test.mjs"   # 37 个测试，含真实 HTTP 与 Workers 双外壳
```

---

## 4. 接口

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/api/v1/join` | `{card, pubkey, pow}` | `{token, expiresIn}` |
| POST | `/api/v1/match` | `{token, limit?}` | `{matches:[{token,pubkey,band,score,shared}], count}` |
| POST | `/api/v1/candidates` | `{token}` | `{items:[{token,card,pubkey}], total}` |
| POST | `/api/v1/interest` | `{token, to, blob}` | `{state:'pending'\|'mutual'}` |
| GET | `/api/v1/inbox?token=` | — | `{items, sent}` |
| POST | `/api/v1/block` | `{token, target}` | `{ok}` |
| POST | `/api/v1/leave` | `{token}` | `{ok}` |
| GET | `/api/v1/health` | — | `{ok, storage}` |
| GET | `/` | — | 服务说明 JSON（**不是网页**） |

错误统一是 `{ "error": "code" }`，HTTP 状态码区分 400/403/404/429/500。

### `/match` 与 `/candidates` 的区别

| | `/match`（推荐） | `/candidates` |
|---|---|---|
| 谁排序 | **服务器** | 客户端 |
| 下发内容 | 只几个公钥 + 分档 + 共同点**数量** | 最多 40 张完整名片 |
| 带宽 | ~1 KB | ~40 KB |
| 服务器是否知道"谁像谁" | **知道** | 不知道 |

`/match` 的响应里**没有**对方的分区/标签/昵称——只有 `{token, pubkey, band, score, shared:{partitions,tags}}`。
即使响应被截获，也拿不到对方的兴趣内容；具体标签要等双方同意后交换名片才有。

---

## 5. 召回：语义倒排，不用 SimHash

检测报告的实测结论是 SimHash + 4×16 分桶不能用（中相似召回 0%、极不相似误命中 13.8%、
桶严重倾斜）。这里改成**语义粗键**：

```
key0 = p:<占比最高的分区>
key1 = t:<权重最高的标签>
key2 = c:<最高标签>+<次高标签>     （次高 ≥ 最高的 75% 时才建）
```

召回 = 三个倒排集合取并集 → 过滤（自己 / 屏蔽 / 已过期）→ 随机抽样。

**k-匿名**：某个桶里少于 5 个人，整桶跳过（`skippedBuckets` 会告诉你跳了几桶）。
**抽样**：每次随机打乱再取前 N，避免调用者按顺序把池子扫穿。
**限额**：每 token 每日 120 张候选卡、20 次"想认识"；每 IP 每日 3 个 token。
**建号成本**：需要一段前导零 12 位的 SHA-256 工作量证明。

---

## 6. 存储键

| 键 | 类型 | TTL |
|---|---|---|
| `tok:<token>` | JSON `{card, pubkey, keys, at}` | 30 天 |
| `band:<key>` | Set，元素是 token | 30 天 |
| `req:<from>:<to>` | JSON `{blob, at}` | 7 天 |
| `inbox:<token>` / `outbox:<token>` | Set | 7 天 |
| `blk:<token>` | Set | 30 天 |
| `rl:<bucket>:<subject>:<日期>` | 计数器 | 1 天 |

退出（`/leave`）= 从所有桶、信箱、索引里删干净，不是打标记。

---

## 7. 已知边界

1. **服务端知道"谁想认识谁"**——这是协议本身暴露的定向元数据，只能靠"不知道相似度"
   来降低价值，不能消除。
2. **token 就是身份**，长期不变；轮换要重入池。再往上做需要短期令牌 + 不可链接设计。
3. **k-匿名与日限额只防单次查询**，防不住长期差分攻击；要更强得加全局查询预算。
4. **没有实名/账号体系**，因此无法防同一人多号；PoW 只抬高了批量成本。
5. **不让任何人看别人的名片**：候选接口只能拿到"和你有共同粗键"的人，且必须自己
   先入池、先有 token。

---

## 8. 不给别人部署的东西

如果你只是自己用，把服务端和插件都跑在自己机器上就行（本地地址 + 内网穿透）。
公开服务等于成为一个"提供匹配服务"的运营者，那是另一套合规口径——
这一点在 `docs/合规说明.md` 里写明了。
