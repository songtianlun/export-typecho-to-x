import { Pool } from 'pg';
import { DatabaseConfig, TypechoPost, TypechoMeta, TypechoLink, TypechoComment } from '../types';

export class TypechoClient {
  private pool: Pool;
  private prefix: string;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });
    this.prefix = config.prefix;
  }

  private table(name: string): string {
    return `${this.prefix}${name}`;
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('Connected to Typecho database successfully.');
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // 获取所有文章
  async getPosts(): Promise<TypechoPost[]> {
    return this.getContents('post');
  }

  // 获取所有页面
  async getPages(): Promise<TypechoPost[]> {
    return this.getContents('page');
  }

  // 获取指定类型的内容（文章或页面）
  private async getContents(type: 'post' | 'page'): Promise<TypechoPost[]> {
    const contentsTable = this.table('contents');
    const relationshipsTable = this.table('relationships');
    const metasTable = this.table('metas');

    // 查询所有已发布/草稿内容
    const contentsResult = await this.pool.query<{
      cid: number;
      title: string;
      slug: string;
      created: number;
      modified: number;
      text: string;
      status: string;
      type: string;
    }>(`
      SELECT cid, title, slug, created, modified, text, status, type
      FROM ${contentsTable}
      WHERE type = $1
      ORDER BY created DESC
    `, [type]);

    const contents: TypechoPost[] = [];

    for (const row of contentsResult.rows) {
      // 获取该内容的分类和标签
      const metasResult = await this.pool.query<TypechoMeta>(`
        SELECT m.mid, m.name, m.slug, m.type, m.description, m.count, m."order"
        FROM ${metasTable} m
        INNER JOIN ${relationshipsTable} r ON m.mid = r.mid
        WHERE r.cid = $1
      `, [row.cid]);

      const categories: string[] = [];
      const tags: string[] = [];

      for (const meta of metasResult.rows) {
        if (meta.type === 'category') {
          categories.push(meta.name);
        } else if (meta.type === 'tag') {
          tags.push(meta.name);
        }
      }

      contents.push({
        cid: row.cid,
        title: row.title,
        slug: row.slug,
        created: row.created,
        modified: row.modified,
        text: this.cleanContent(row.text),
        status: row.status as TypechoPost['status'],
        type: row.type,
        categories,
        tags,
      });
    }

    return contents;
  }

  // 获取所有友链 (handsome 主题)
  async getLinks(): Promise<TypechoLink[]> {
    const linksTable = this.table('links');

    const result = await this.pool.query<{
      lid: number;
      name: string;
      url: string;
      sort: string;
      image: string;
      description: string;
      user: string;
      order: number;
    }>(`
      SELECT lid, name, url, sort, image, description, "user", "order"
      FROM ${linksTable}
      ORDER BY "order" ASC
    `);

    return result.rows.map((row) => ({
      lid: row.lid,
      name: row.name || '',
      url: row.url || '',
      sort: row.sort || '',
      image: row.image || '',
      description: row.description || '',
      user: row.user || '',
      order: row.order || 0,
    }));
  }

  // 获取所有分类
  async getCategories(): Promise<TypechoMeta[]> {
    const metasTable = this.table('metas');

    const result = await this.pool.query<TypechoMeta>(`
      SELECT mid, name, slug, type, description, count, "order"
      FROM ${metasTable}
      WHERE type = 'category'
      ORDER BY "order" ASC
    `);

    return result.rows;
  }

  // 获取所有评论
  async getComments(): Promise<TypechoComment[]> {
    const commentsTable = this.table('comments');

    const result = await this.pool.query<{
      coid: number;
      cid: number;
      created: number;
      author: string;
      authorId: number;
      ownerId: number;
      mail: string;
      url: string;
      ip: string;
      agent: string;
      text: string;
      type: string;
      status: string;
      parent: number;
    }>(`
      SELECT coid, cid, created, author, "authorId", "ownerId", mail, url, ip, agent, text, type, status, parent
      FROM ${commentsTable}
      WHERE status = 'approved' AND type = 'comment'
      ORDER BY created ASC
    `);

    return result.rows.map((row) => ({
      coid: row.coid,
      cid: row.cid,
      created: row.created,
      author: row.author || 'Anonymous',
      authorId: row.authorId || 0,
      ownerId: row.ownerId || 0,
      mail: row.mail || '',
      url: row.url || '',
      ip: row.ip || '',
      agent: row.agent || '',
      text: row.text || '',
      type: row.type || 'comment',
      status: row.status || 'approved',
      parent: row.parent || 0,
    }));
  }

  // 获取 Typecho 配置项
  async getOption(name: string): Promise<string | null> {
    const optionsTable = this.table('options');

    const result = await this.pool.query<{ value: string }>(`
      SELECT value FROM ${optionsTable}
      WHERE name = $1 AND "user" = 0
    `, [name]);

    return result.rows[0]?.value || null;
  }

  // 获取路由配置
  async getRoutingTable(): Promise<{ post: string; page: string }> {
    const routingValue = await this.getOption('routingTable');

    // 默认路由
    let postPattern = '/archives/{slug}.html';
    let pagePattern = '/{slug}.html';

    if (routingValue) {
      // 解析 PHP 序列化格式的路由表
      // 提取 post 和 page 的 url 模式
      const postMatch = routingValue.match(/s:4:"post"[^}]*s:3:"url";s:\d+:"([^"]+)"/);
      const pageMatch = routingValue.match(/s:4:"page"[^}]*s:3:"url";s:\d+:"([^"]+)"/);

      if (postMatch) {
        postPattern = postMatch[1];
      }
      if (pageMatch) {
        pagePattern = pageMatch[1];
      }
    }

    return { post: postPattern, page: pagePattern };
  }

  // 根据路由模式生成 URL
  generateUrl(pattern: string, content: TypechoPost): string {
    const date = new Date(content.created * 1000);

    return pattern
      .replace(/\[slug\]/g, content.slug)
      .replace(/\{slug\}/g, content.slug)
      .replace(/\[cid\]/g, String(content.cid))
      .replace(/\{cid\}/g, String(content.cid))
      .replace(/\[year\]/g, String(date.getFullYear()))
      .replace(/\{year\}/g, String(date.getFullYear()))
      .replace(/\[month\]/g, String(date.getMonth() + 1).padStart(2, '0'))
      .replace(/\{month\}/g, String(date.getMonth() + 1).padStart(2, '0'))
      .replace(/\[day\]/g, String(date.getDate()).padStart(2, '0'))
      .replace(/\{day\}/g, String(date.getDate()).padStart(2, '0'));
  }

  // 清理文章内容（移除 Typecho 特殊标记）
  private cleanContent(text: string): string {
    // 移除 <!--markdown--> 标记
    let content = text.replace(/<!--markdown-->/gi, '');
    // 移除开头的 <!--more--> 之前的内容标记（如果需要的话可以保留）
    // content = content.replace(/<!--more-->/gi, '\n\n---\n\n');
    return content.trim();
  }
}
