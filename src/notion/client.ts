import { Client } from '@notionhq/client';
import {
  CreatePageParameters,
  UpdatePageParameters,
  BlockObjectRequest,
  UpdateDatabaseParameters,
} from '@notionhq/client/build/src/api-endpoints';
import { NotionConfig, TypechoPost, NotionPageMap } from '../types';

// Notion 支持的代码语言类型
type CodeLanguage =
  | 'abap' | 'arduino' | 'bash' | 'basic' | 'c' | 'clojure' | 'coffeescript'
  | 'c++' | 'c#' | 'css' | 'dart' | 'diff' | 'docker' | 'elixir' | 'elm'
  | 'erlang' | 'flow' | 'fortran' | 'f#' | 'gherkin' | 'glsl' | 'go' | 'graphql'
  | 'groovy' | 'haskell' | 'html' | 'java' | 'javascript' | 'json' | 'julia'
  | 'kotlin' | 'latex' | 'less' | 'lisp' | 'livescript' | 'lua' | 'makefile'
  | 'markdown' | 'markup' | 'matlab' | 'mermaid' | 'nix' | 'objective-c' | 'ocaml'
  | 'pascal' | 'perl' | 'php' | 'plain text' | 'powershell' | 'prolog' | 'protobuf'
  | 'python' | 'r' | 'reason' | 'ruby' | 'rust' | 'sass' | 'scala' | 'scheme'
  | 'scss' | 'shell' | 'sql' | 'swift' | 'typescript' | 'vb.net' | 'verilog'
  | 'vhdl' | 'visual basic' | 'webassembly' | 'xml' | 'yaml' | 'java/c/c++/c#';

// 需要创建的数据库属性（不包括 title，因为数据库默认有）
const REQUIRED_PROPERTIES = {
  Slug: { rich_text: {} },
  Cid: { number: {} },
  Category: { multi_select: {} },
  Tags: { multi_select: {} },
  Status: {
    select: {
      options: [
        { name: 'publish', color: 'green' as const },
        { name: 'draft', color: 'yellow' as const },
        { name: 'hidden', color: 'gray' as const },
        { name: 'waiting', color: 'orange' as const },
        { name: 'private', color: 'red' as const },
      ],
    },
  },
  Created: { date: {} },
  Modified: { date: {} },
};

export class NotionClient {
  private client: Client;
  private databaseId: string;
  private titlePropertyName: string = 'Name'; // 默认 title 属性名

  constructor(config: NotionConfig) {
    this.client = new Client({ auth: config.apiKey });
    this.databaseId = config.databaseId;
  }

  // 检查并创建缺失的数据库属性
  async ensureDatabaseProperties(): Promise<void> {
    const database = await this.client.databases.retrieve({
      database_id: this.databaseId,
    });

    const existingProperties = database.properties;

    // 找到现有的 title 属性名称
    for (const [name, prop] of Object.entries(existingProperties)) {
      if (prop.type === 'title') {
        this.titlePropertyName = name;
        console.log(`Found title property: "${name}"`);
        break;
      }
    }

    const missingProperties: UpdateDatabaseParameters['properties'] = {};

    for (const [name, config] of Object.entries(REQUIRED_PROPERTIES)) {
      if (!existingProperties[name]) {
        console.log(`Creating missing property: ${name}`);
        missingProperties[name] = config as any;
      }
    }

    if (Object.keys(missingProperties).length > 0) {
      await this.client.databases.update({
        database_id: this.databaseId,
        properties: missingProperties,
      });
      console.log('Database properties updated successfully.');
    } else {
      console.log('All required properties exist.');
    }
  }

  // 查询已存在的文章（通过 slug）
  async queryExistingPosts(): Promise<NotionPageMap> {
    const pageMap: NotionPageMap = {};
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        start_cursor: startCursor,
        page_size: 100,
      });

      for (const page of response.results) {
        if ('properties' in page) {
          const slugProp = page.properties['Slug'];
          if (slugProp && slugProp.type === 'rich_text') {
            const richTextArray = slugProp.rich_text as Array<{ plain_text: string }>;
            if (richTextArray.length > 0) {
              const slug = richTextArray[0].plain_text;
              const modifiedProp = page.properties['Modified'];
              let modified: string | undefined;
              if (modifiedProp && modifiedProp.type === 'date' && modifiedProp.date) {
                modified = modifiedProp.date.start;
              }
              pageMap[slug] = { pageId: page.id, modified };
            }
          }
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor ?? undefined;
    }

    return pageMap;
  }

  // 创建新页面
  async createPage(post: TypechoPost): Promise<string> {
    const properties = this.buildProperties(post);
    const children = this.convertContentToBlocks(post.text);

    const response = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties,
      children,
    } as CreatePageParameters);

    return response.id;
  }

  // 更新已存在的页面
  async updatePage(pageId: string, post: TypechoPost): Promise<void> {
    const properties = this.buildProperties(post);

    // 更新页面属性
    await this.client.pages.update({
      page_id: pageId,
      properties,
    } as UpdatePageParameters);

    // 删除现有内容块并添加新内容
    await this.replacePageContent(pageId, post.text);
  }

  // 构建页面属性
  private buildProperties(post: TypechoPost): CreatePageParameters['properties'] {
    const createdDate = new Date(post.created * 1000).toISOString();
    const modifiedDate = new Date(post.modified * 1000).toISOString();

    return {
      [this.titlePropertyName]: {
        title: [{ text: { content: post.title } }],
      },
      Slug: {
        rich_text: [{ text: { content: post.slug } }],
      },
      Cid: {
        number: post.cid,
      },
      Category: {
        multi_select: post.categories.map((name) => ({ name })),
      },
      Tags: {
        multi_select: post.tags.map((name) => ({ name })),
      },
      Status: {
        select: { name: post.status },
      },
      Created: {
        date: { start: createdDate },
      },
      Modified: {
        date: { start: modifiedDate },
      },
    };
  }

  // 将 Markdown 内容转换为 Notion blocks
  private convertContentToBlocks(content: string): BlockObjectRequest[] {
    const blocks: BlockObjectRequest[] = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (line.startsWith('```')) {
        const language = line.slice(3).trim() || 'plain text';
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: codeLines.join('\n').substring(0, 2000) } }],
            language: this.mapLanguage(language),
          },
        });
        i++;
        continue;
      }

      // 标题
      if (line.startsWith('### ')) {
        blocks.push({
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
          },
        });
        i++;
        continue;
      }

      if (line.startsWith('## ')) {
        blocks.push({
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
          },
        });
        i++;
        continue;
      }

      if (line.startsWith('# ')) {
        blocks.push({
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
        i++;
        continue;
      }

      // 引用
      if (line.startsWith('> ')) {
        blocks.push({
          type: 'quote',
          quote: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
        i++;
        continue;
      }

      // 无序列表
      if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
          },
        });
        i++;
        continue;
      }

      // 有序列表
      const orderedMatch = line.match(/^\d+\.\s/);
      if (orderedMatch) {
        blocks.push({
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: line.slice(orderedMatch[0].length) } }],
          },
        });
        i++;
        continue;
      }

      // 分割线
      if (line === '---' || line === '***' || line === '___') {
        blocks.push({
          type: 'divider',
          divider: {},
        });
        i++;
        continue;
      }

      // 普通段落（跳过空行）
      if (line.trim()) {
        // Notion rich_text 有 2000 字符限制
        const truncatedContent = line.substring(0, 2000);
        blocks.push({
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: truncatedContent } }],
          },
        });
      }

      i++;
    }

    return blocks;
  }

  // 映射编程语言到 Notion 支持的语言
  private mapLanguage(lang: string): CodeLanguage {
    const languageMap: { [key: string]: CodeLanguage } = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      rb: 'ruby',
      sh: 'bash',
      yml: 'yaml',
      dockerfile: 'docker',
      md: 'markdown',
    };
    const mapped = languageMap[lang.toLowerCase()];
    if (mapped) return mapped;
    // 尝试作为有效语言返回，否则使用 plain text
    const normalized = lang.toLowerCase() as CodeLanguage;
    return normalized || 'plain text';
  }

  // 替换页面内容
  private async replacePageContent(pageId: string, content: string): Promise<void> {
    // 获取现有块
    const existingBlocks = await this.client.blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    // 删除现有块
    for (const block of existingBlocks.results) {
      if ('id' in block) {
        await this.client.blocks.delete({ block_id: block.id });
      }
    }

    // 添加新内容
    const newBlocks = this.convertContentToBlocks(content);
    if (newBlocks.length > 0) {
      // Notion API 限制每次最多添加 100 个块
      for (let i = 0; i < newBlocks.length; i += 100) {
        const chunk = newBlocks.slice(i, i + 100);
        await this.client.blocks.children.append({
          block_id: pageId,
          children: chunk,
        });
      }
    }
  }
}
