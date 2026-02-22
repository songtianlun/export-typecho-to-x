# Mix-Space Core API 数据导入指南

## 概述

Mix-Space Core 是基于 NestJS + MongoDB 的 RESTful API 服务。API 基础路径为 `/api/v2`，所有写操作需要认证。

---

## 认证方式

所有创建/修改操作需要 Auth 认证，支持以下方式：

| 方式 | 格式 |
|------|------|
| API Key Header | `X-API-Key: txo<40字符token>` |
| Bearer Token | `Authorization: Bearer <token>` |
| Query 参数 | `?token=<token>` |

API Key 格式以 `txo` 开头，总长度 43 字符。可在后台管理面板 → 设定 → API Token 中创建。

---

## 1. 分类 (Categories)

分类必须先于文章创建，因为文章需要引用 `categoryId`。

### 创建分类

```http
POST /api/v2/categories
X-API-Key: txo...

{
  "name": "技术",
  "slug": "tech",
  "type": 0
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 分类名称 |
| `slug` | string | 否 | URL slug，不填则自动生成 |
| `type` | number | 否 | `0` = 分类(默认)，`1` = 标签 |

**响应**会返回包含 `_id` 的完整分类对象，记录此 `_id` 用于后续创建文章。

### 获取所有分类

```http
GET /api/v2/categories
```

### 更新分类

```http
PUT /api/v2/categories/:id
X-API-Key: txo...

{
  "name": "新名称",
  "slug": "new-slug"
}
```

---

## 2. 文章 (Posts)

### 创建文章

```http
POST /api/v2/posts
X-API-Key: txo...

{
  "title": "文章标题",
  "slug": "article-slug",
  "text": "Markdown 正文内容...",
  "categoryId": "60f1b2c3d4e5f6a7b8c9d0e1",
  "summary": "文章摘要",
  "tags": ["tag1", "tag2"],
  "copyright": true,
  "isPublished": true,
  "created": "2024-01-15T08:00:00.000Z"
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 文章标题 |
| `text` | string | ✅ | 正文 (Markdown) |
| `slug` | string | ✅ | URL slug，同分类下唯一 |
| `categoryId` | string | ✅ | 分类的 MongoDB ObjectId |
| `summary` | string | 否 | 摘要 |
| `tags` | string[] | 否 | 标签数组（去重） |
| `copyright` | boolean | 否 | 版权标识，默认 `true` |
| `isPublished` | boolean | 否 | 是否发布，默认 `true` |
| `created` | string | 否 | 创建时间 (ISO 8601)，不填为当前时间 |
| `pin` | string/null | 否 | 置顶时间 |
| `pinOrder` | number | 否 | 置顶排序 |
| `relatedId` | string[] | 否 | 关联文章的 ObjectId 数组 |
| `images` | object[] | 否 | 图片信息数组 |
| `meta` | object | 否 | 自定义元数据 |
| `contentFormat` | string | 否 | `"markdown"`(默认) 或 `"lexical"` |

### 更新文章

```http
PUT /api/v2/posts/:id
X-API-Key: txo...

{ /* 完整的文章字段 */ }
```

### 部分更新

```http
PATCH /api/v2/posts/:id
X-API-Key: txo...

{ "title": "只更新标题" }
```

### 获取文章列表

```http
GET /api/v2/posts?page=1&size=10&sortBy=created&sortOrder=-1
```

---

## 3. 独立页面 (Pages)

### 创建页面

```http
POST /api/v2/pages
X-API-Key: txo...

{
  "title": "关于我",
  "slug": "about",
  "text": "页面 Markdown 内容...",
  "subtitle": "副标题",
  "order": 1
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 页面标题 |
| `text` | string | ✅ | 正文 (Markdown) |
| `slug` | string | ✅ | URL slug |
| `subtitle` | string | 否 | 副标题 |
| `order` | number | 否 | 排序权重，默认 `1` |
| `images` | object[] | 否 | 图片信息数组 |
| `created` | string | 否 | 创建时间 (ISO 8601) |
| `meta` | object | 否 | 自定义元数据 |

### 更新页面

```http
PUT /api/v2/pages/:id
X-API-Key: txo...

{ /* 完整的页面字段 */ }
```

### 页面排序

```http
PATCH /api/v2/pages/reorder
X-API-Key: txo...

{
  "seq": [
    { "id": "ObjectId1", "order": 1 },
    { "id": "ObjectId2", "order": 2 }
  ]
}
```

---

## 4. 评论 (Comments)

### 评论模型说明

评论通过 `ref` 关联到目标内容，`refType` 指定目标类型：

| refType 值 | 说明 |
|------------|------|
| `posts` | 文章评论 |
| `notes` | 日记/笔记评论 |
| `pages` | 页面评论 |
| `recentlies` | 最近评论 |

### 以游客身份创建评论

```http
POST /api/v2/comments/:refId?ref=posts
Content-Type: application/json

{
  "author": "访客名称",
  "text": "评论内容",
  "mail": "visitor@example.com",
  "url": "https://visitor-site.com",
  "isWhispers": false
}
```

这里 `:refId` 是目标文章/页面/笔记的 ObjectId，`ref` 查询参数指定类型。

### 以站长身份创建评论

```http
POST /api/v2/comments/owner/comment/:refId?ref=posts
X-API-Key: txo...

{
  "text": "站长评论内容"
}
```

### 回复评论

```http
POST /api/v2/comments/reply/:commentId

{
  "author": "回复者",
  "text": "回复内容",
  "mail": "reply@example.com"
}
```

以站长身份回复：

```http
POST /api/v2/comments/owner/reply/:commentId
X-API-Key: txo...

{
  "text": "站长回复内容"
}
```

**评论字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `author` | string | ✅ | 评论者昵称 (≤20字符) |
| `text` | string | ✅ | 评论内容 (≤500字符) |
| `mail` | string | ✅ | 邮箱地址 |
| `url` | string | 否 | 个人网站 |
| `isWhispers` | boolean | 否 | 是否悄悄话（仅站长可见） |
| `avatar` | string | 否 | 头像 URL (必须 HTTPS) |

### 管理评论状态

```http
PATCH /api/v2/comments/:id
X-API-Key: txo...

{
  "state": 1,
  "pin": false
}
```

评论状态: `0` = 未读, `1` = 已读, `2` = 垃圾

### 获取某篇文章的评论

```http
GET /api/v2/comments/ref/:refId?page=1&size=10
```

---

## 5. 备份与恢复 (Backup)

Mix-Space 还支持完整的备份与恢复功能。

### 创建备份

```http
GET /api/v2/backups/new
X-API-Key: txo...
```

返回一个 ZIP 文件，包含所有 MongoDB 数据的 JSON 导出。

### 上传并恢复备份

```http
POST /api/v2/backups/rollback/
X-API-Key: txo...
Content-Type: multipart/form-data

file=@backup.zip
```

### 回滚到已有备份

```http
PATCH /api/v2/backups/rollback/:dirname
X-API-Key: txo...
```

---

## 批量导入脚本示例

以下是一个完整的 Python 批量导入脚本示例：

```python
import requests
import json
import time

BASE_URL = "https://your-api-domain.com/api/v2"
API_KEY = "txoYOUR_API_KEY_HERE"

headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY
}

# ========== 1. 创建分类 ==========
categories = [
    {"name": "技术", "slug": "tech"},
    {"name": "生活", "slug": "life"},
    {"name": "随笔", "slug": "essay"},
]

category_map = {}  # slug -> id

for cat in categories:
    resp = requests.post(f"{BASE_URL}/categories", json=cat, headers=headers)
    if resp.status_code in (200, 201):
        data = resp.json()
        # 响应嵌套在 data 字段中
        cat_data = data.get("data", data)
        category_map[cat["slug"]] = cat_data["_id"]
        print(f"✅ 分类 '{cat['name']}' 创建成功: {cat_data['_id']}")
    else:
        print(f"❌ 分类 '{cat['name']}' 创建失败: {resp.text}")

# ========== 2. 导入文章 ==========
posts = [
    {
        "title": "第一篇文章",
        "slug": "first-post",
        "text": "# Hello\n\n这是文章内容...",
        "categoryId": category_map["tech"],
        "tags": ["hello", "first"],
        "summary": "第一篇文章的摘要",
        "created": "2024-01-01T00:00:00.000Z",
        "isPublished": True,
    },
    {
        "title": "第二篇文章",
        "slug": "second-post",
        "text": "# World\n\n这是第二篇...",
        "categoryId": category_map["life"],
        "tags": ["life"],
        "created": "2024-02-01T00:00:00.000Z",
        "isPublished": True,
    },
]

post_map = {}  # slug -> id

for post in posts:
    resp = requests.post(f"{BASE_URL}/posts", json=post, headers=headers)
    if resp.status_code in (200, 201):
        data = resp.json()
        post_data = data.get("data", data)
        post_map[post["slug"]] = post_data["_id"]
        print(f"✅ 文章 '{post['title']}' 创建成功: {post_data['_id']}")
    else:
        print(f"❌ 文章 '{post['title']}' 创建失败: {resp.text}")
    time.sleep(0.5)  # 避免请求过快

# ========== 3. 导入页面 ==========
pages = [
    {
        "title": "关于",
        "slug": "about",
        "text": "# 关于我\n\n介绍内容...",
        "order": 1,
    },
    {
        "title": "友情链接",
        "slug": "friends",
        "text": "# 友链\n\n链接内容...",
        "order": 2,
    },
]

for page in pages:
    resp = requests.post(f"{BASE_URL}/pages", json=page, headers=headers)
    if resp.status_code in (200, 201):
        data = resp.json()
        print(f"✅ 页面 '{page['title']}' 创建成功")
    else:
        print(f"❌ 页面 '{page['title']}' 创建失败: {resp.text}")

# ========== 4. 导入评论 ==========
comments = [
    {
        "ref_id": post_map["first-post"],
        "ref_type": "posts",
        "author": "张三",
        "text": "写得不错！",
        "mail": "zhang@example.com",
    },
    {
        "ref_id": post_map["second-post"],
        "ref_type": "posts",
        "author": "李四",
        "text": "很有意思",
        "mail": "li@example.com",
        "url": "https://lisi.com",
    },
]

for comment in comments:
    ref_id = comment.pop("ref_id")
    ref_type = comment.pop("ref_type")
    resp = requests.post(
        f"{BASE_URL}/comments/{ref_id}?ref={ref_type}",
        json=comment,
        headers=headers,
    )
    if resp.status_code in (200, 201):
        print(f"✅ 评论 by '{comment['author']}' 创建成功")
    else:
        print(f"❌ 评论创建失败: {resp.text}")

print("\n🎉 导入完成!")
```

---

## 注意事项

1. **导入顺序**：分类 → 文章 → 页面 → 评论（评论需要关联目标的 ObjectId）
2. **幂等控制**：POST 请求带有幂等性保护（20秒内相同请求会被拒绝），批量导入时注意间隔
3. **Slug 唯一性**：同一分类下 slug 不能重复，页面的 slug 全局唯一
4. **Markdown 内容**：`text` 字段存储 Markdown 原文，`contentFormat` 默认为 `"markdown"`
5. **时间字段**：`created` 接受 ISO 8601 格式，不传则为当前时间
6. **Swagger 文档**：运行中的 Mix-Space 实例可能在 `/api/v2/swagger-ui` 提供交互式 API 文档
7. **API 响应格式**：响应通常包裹在 `{ "ok": 1, "data": { ... } }` 结构中
