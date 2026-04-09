import * as fs from 'fs';
import * as path from 'path';
import { TypechoPost } from '../types';

export class HugoExporter {
  private postsDir: string;
  private pagesDir: string;

  constructor(outputDir: string) {
    this.postsDir = path.join(outputDir, 'posts');
    this.pagesDir = path.join(outputDir, 'pages');
  }

  /**
   * 导出文章到 Hugo Markdown 文件
   */
  async exportPost(post: TypechoPost): Promise<{ action: 'created' | 'updated' | 'skipped'; filename: string }> {
    this.ensureDir(this.postsDir);

    const filename = this.generatePostFilename(post);
    const filepath = path.join(this.postsDir, filename);

    return this.writeContent(filepath, post, filename);
  }

  /**
   * 导出页面到 Hugo Markdown 文件
   */
  async exportPage(page: TypechoPost): Promise<{ action: 'created' | 'updated' | 'skipped'; filename: string }> {
    this.ensureDir(this.pagesDir);

    const filename = `${page.slug}.md`;
    const filepath = path.join(this.pagesDir, filename);

    return this.writeContent(filepath, page, filename);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private writeContent(
    filepath: string,
    post: TypechoPost,
    filename: string
  ): { action: 'created' | 'updated' | 'skipped'; filename: string } {
    // 检查文件是否已存在
    if (fs.existsSync(filepath)) {
      const existingContent = fs.readFileSync(filepath, 'utf-8');
      const existingLastmod = this.extractLastmodFromFrontmatter(existingContent);

      if (existingLastmod) {
        const postModified = new Date(post.modified * 1000).toISOString();
        if (postModified <= existingLastmod) {
          return { action: 'skipped', filename };
        }
      }

      this.writeMarkdownFile(filepath, post);
      return { action: 'updated', filename };
    }

    this.writeMarkdownFile(filepath, post);
    return { action: 'created', filename };
  }

  /**
   * 生成文章文件名：YYYY-MM-DD-slug.md
   */
  private generatePostFilename(post: TypechoPost): string {
    const date = new Date(post.created * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}-${post.slug}.md`;
  }

  /**
   * 写入 Hugo Markdown 文件
   */
  private writeMarkdownFile(filepath: string, post: TypechoPost): void {
    const frontmatter = this.generateFrontmatter(post);
    const content = `${frontmatter}\n\n${post.text}\n`;
    fs.writeFileSync(filepath, content, 'utf-8');
  }

  /**
   * 生成 Hugo 兼容的 YAML frontmatter
   */
  private generateFrontmatter(post: TypechoPost): string {
    const date = new Date(post.created * 1000).toISOString();
    const lastmod = new Date(post.modified * 1000).toISOString();
    const draft = post.status !== 'publish';

    // 转义标题中的双引号
    const title = post.title.replace(/"/g, '\\"');

    // 分类列表
    const categoriesYaml = post.categories.length > 0
      ? `categories:\n${post.categories.map(c => `  - "${c.replace(/"/g, '\\"')}"`).join('\n')}`
      : `categories: []`;

    // 标签列表
    const tagsYaml = post.tags.length > 0
      ? `tags:\n${post.tags.map(t => `  - "${t.replace(/"/g, '\\"')}"`).join('\n')}`
      : `tags: []`;

    return `---
title: "${title}"
date: ${date}
lastmod: ${lastmod}
draft: ${draft}
slug: "${post.slug}"
${categoriesYaml}
${tagsYaml}
---`;
  }

  /**
   * 从 frontmatter 中提取 lastmod 时间（用于跳过未更新文件）
   */
  private extractLastmodFromFrontmatter(content: string): string | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = match[1];
    const lastmodMatch = frontmatter.match(/^lastmod:\s*(.+)$/m);
    return lastmodMatch ? lastmodMatch[1].trim() : null;
  }
}
