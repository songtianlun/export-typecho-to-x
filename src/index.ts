import { validateConfig, notionConfig, typechoDbConfig } from './config';
import { TypechoClient } from './typecho/client';
import { NotionClient } from './notion/client';
import { SyncResult, TypechoPost } from './types';
import { getCachedPosts, setCachedPosts, clearCache } from './cache';

// 解析命令行参数
function parseArgs(): { noCache: boolean; clearCache: boolean } {
  const args = process.argv.slice(2);
  return {
    noCache: args.includes('--no-cache'),
    clearCache: args.includes('--clear-cache'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('='.repeat(50));
  console.log('Typecho to Notion Sync Tool');
  console.log('='.repeat(50));
  console.log();

  // 处理 --clear-cache
  if (args.clearCache) {
    clearCache();
    if (process.argv.length === 3) {
      return; // 只有 --clear-cache 参数时，清除后退出
    }
  }

  // 验证配置
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', (error as Error).message);
    process.exit(1);
  }

  console.log();

  // 初始化客户端
  const typechoClient = new TypechoClient(typechoDbConfig);
  const notionClient = new NotionClient(notionConfig);

  const result: SyncResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  let posts: TypechoPost[] = [];

  try {
    // 尝试从缓存获取文章
    console.log('\nFetching posts...');

    if (!args.noCache) {
      const cached = getCachedPosts();
      if (cached) {
        posts = cached;
      }
    } else {
      console.log('Cache disabled (--no-cache)');
    }

    // 如果没有缓存，从数据库获取
    if (posts.length === 0) {
      console.log('Connecting to Typecho database...');
      await typechoClient.connect();
      posts = await typechoClient.getPosts();
      await typechoClient.close();

      // 保存到缓存
      if (posts.length > 0) {
        setCachedPosts(posts);
      }
    }

    result.total = posts.length;
    console.log(`Total: ${posts.length} posts`);
    console.log();

    if (posts.length === 0) {
      console.log('No posts to sync.');
      return;
    }

    // 确保 Notion 数据库属性存在
    console.log('Checking Notion database properties...');
    await notionClient.ensureDatabaseProperties();
    console.log();

    // 获取已存在的文章
    console.log('Querying existing posts in Notion...');
    const existingPosts = await notionClient.queryExistingPosts();
    console.log(`Found ${Object.keys(existingPosts).length} existing posts in Notion.`);
    console.log();

    // 开始同步
    console.log('Starting sync...');
    console.log('-'.repeat(50));

    for (const post of posts) {
      try {
        const existing = existingPosts[post.slug];

        if (existing) {
          // 检查是否需要更新（比较修改时间）
          const postModified = new Date(post.modified * 1000).toISOString();
          if (existing.modified && existing.modified >= postModified) {
            console.log(`[SKIP] "${post.title}" (slug: ${post.slug}) - not modified`);
            result.skipped++;
            continue;
          }

          // 更新已存在的文章
          console.log(`[UPDATE] "${post.title}" (slug: ${post.slug})`);
          await notionClient.updatePage(existing.pageId, post);
          result.updated++;
        } else {
          // 创建新文章
          console.log(`[CREATE] "${post.title}" (slug: ${post.slug})`);
          await notionClient.createPage(post);
          result.created++;
        }

        // 添加小延迟避免 API 限制
        await sleep(350);
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`[FAILED] "${post.title}" - ${errorMessage}`);
        result.failed++;
        result.errors.push({ title: post.title, error: errorMessage });
      }
    }

    console.log('-'.repeat(50));
    console.log();

  } catch (error) {
    console.error('Sync error:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }

  // 打印同步统计
  console.log('='.repeat(50));
  console.log('Sync Summary');
  console.log('='.repeat(50));
  console.log(`Total posts:    ${result.total}`);
  console.log(`Created:        ${result.created}`);
  console.log(`Updated:        ${result.updated}`);
  console.log(`Skipped:        ${result.skipped}`);
  console.log(`Failed:         ${result.failed}`);

  if (result.errors.length > 0) {
    console.log();
    console.log('Errors:');
    for (const { title, error } of result.errors) {
      console.log(`  - ${title}: ${error}`);
    }
  }

  console.log('='.repeat(50));
  console.log('Sync completed!');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 运行主程序
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
