// Typecho 文章数据结构
export interface TypechoPost {
  cid: number;
  title: string;
  slug: string;
  created: number; // Unix timestamp
  modified: number; // Unix timestamp
  text: string;
  status: 'publish' | 'draft' | 'hidden' | 'waiting' | 'private';
  type: string;
  categories: string[];
  tags: string[];
}

// Typecho 友链数据结构 (handsome 主题)
export interface TypechoLink {
  lid: number;
  name: string;
  url: string;
  sort: string; // 分类
  image: string; // logo 图
  description: string;
  user: string;
  order: number;
}

// Typecho 元数据（分类/标签）
export interface TypechoMeta {
  mid: number;
  name: string;
  slug: string;
  type: 'category' | 'tag';
  description?: string;
  count: number;
  order: number;
}

// Typecho 评论数据结构
export interface TypechoComment {
  coid: number;        // 评论 ID
  cid: number;         // 文章 ID
  created: number;     // 创建时间 (Unix timestamp)
  author: string;      // 评论者名称
  authorId: number;    // 评论者用户 ID (0 表示游客)
  ownerId: number;     // 文章作者 ID
  mail: string;        // 邮箱
  url: string;         // 网站 URL
  ip: string;          // IP 地址
  agent: string;       // User-Agent
  text: string;        // 评论内容
  type: string;        // 类型 (comment/trackback/pingback)
  status: string;      // 状态 (approved/waiting/spam)
  parent: number;      // 父评论 ID (0 表示顶层评论)
}

// Remark42 用户数据结构
export interface Remark42User {
  name: string;
  id: string;
  picture?: string;  // 可选，不设置则使用 remark42 默认头像
  ip: string;
  admin: boolean;
  site_id: string;
}

// Remark42 定位器
export interface Remark42Locator {
  site: string;
  url: string;
}

// Remark42 评论数据结构
export interface Remark42Comment {
  id: string;
  pid: string;
  text: string;
  orig: string;
  user: Remark42User;
  locator: Remark42Locator;
  score: number;
  vote: number;
  time: string;
  title: string;
}

// 同步统计结果
export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ title: string; error: string }>;
}

// Notion 页面映射（slug -> pageId）
export interface NotionPageMap {
  [slug: string]: {
    pageId: string;
    modified?: string;
  };
}

// 数据库配置
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  prefix: string;
}

// Notion 配置
export interface NotionConfig {
  apiKey: string;
  databaseId: string;
}
