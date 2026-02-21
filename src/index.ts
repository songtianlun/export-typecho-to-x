import { validateConfig, validateExportConfig, notionConfig, notionLinksConfig, typechoDbConfig, markdownExportDir } from './config';
import { TypechoClient } from './typecho/client';
import { NotionClient } from './notion/client';
import { NotionLinksClient } from './notion/links-client';
import { MarkdownExporter } from './markdown/exporter';
import { Remark42Exporter } from './remark42/exporter';
import { MxSpaceExporter } from './mxspace/exporter';
import { SyncResult, TypechoPost } from './types';
import { getCachedPosts, setCachedPosts, clearCache } from './cache';
import { cleanBrokenImageLinks } from './utils/image-checker';

// 解析命令行参数
function parseArgs(): {
  noCache: boolean;
  clearCache: boolean;
  skipImageValidation: boolean;
  checkImageLinks: boolean;
  command: 'posts' | 'links' | 'markdown' | 'comments' | 'mxspace';
  outputDir?: string;
  outputFile?: string;
  siteId?: string;
  siteUrl?: string;
} {
  const args = process.argv.slice(2);
  let command: 'posts' | 'links' | 'markdown' | 'comments' | 'mxspace' = 'posts';
  let outputDir: string | undefined;
  let outputFile: string | undefined;
  let siteId: string | undefined;
  let siteUrl: string | undefined;

  if (args.includes('links')) {
    command = 'links';
  } else if (args.includes('markdown') || args.includes('export')) {
    command = 'markdown';
  } else if (args.includes('comments')) {
    command = 'comments';
  } else if (args.includes('mxspace')) {
    command = 'mxspace';
  }

  // 解析 --output-dir 或 -o 参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' || args[i] === '-o') {
      outputDir = args[i + 1];
      break;
    } else if (args[i].startsWith('--output-dir=')) {
      outputDir = args[i].split('=')[1];
      break;
    }
  }

  // 解析 --output-file 或 -f 参数（用于 comments 命令）
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-file' || args[i] === '-f') {
      outputFile = args[i + 1];
      break;
    } else if (args[i].startsWith('--output-file=')) {
      outputFile = args[i].split('=')[1];
      break;
    }
  }

  // 解析 --site-id 参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site-id') {
      siteId = args[i + 1];
      break;
    } else if (args[i].startsWith('--site-id=')) {
      siteId = args[i].split('=')[1];
      break;
    }
  }

  // 解析 --site-url 参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site-url') {
      siteUrl = args[i + 1];
      break;
    } else if (args[i].startsWith('--site-url=')) {
      siteUrl = args[i].split('=')[1];
      break;
    }
  }

  return {
    noCache: args.includes('--no-cache'),
    clearCache: args.includes('--clear-cache'),
    skipImageValidation: args.includes('--skip-image-validation'),
    checkImageLinks: args.includes('--check-image-links'),
    command,
    outputDir,
    outputFile,
    siteId,
    siteUrl,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 同步文章
async function syncPosts(noCache: boolean, skipImageValidation: boolean, checkImageLinks: boolean): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const notionClient = new NotionClient(notionConfig, skipImageValidation);

  if (checkImageLinks) {
    console.log('Image link checking is enabled - broken image links will be removed');
  }

  const result: SyncResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // 图片检查统计
  let totalImagesChecked = 0;
  let totalImagesRemoved = 0;
  const allBrokenImages: Array<{ url: string; statusCode?: number; error?: string }> = [];

  let posts: TypechoPost[] = [];

  try {
    console.log('\nFetching posts...');

    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) {
        posts = cached;
      }
    } else {
      console.log('Cache disabled (--no-cache)');
    }

    if (posts.length === 0) {
      console.log('Connecting to Typecho database...');
      await typechoClient.connect();
      posts = await typechoClient.getPosts();
      await typechoClient.close();

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

    console.log('Checking Notion database properties...');
    await notionClient.ensureDatabaseProperties();
    console.log();

    console.log('Querying existing posts in Notion...');
    const existingPosts = await notionClient.queryExistingPosts();
    console.log(`Found ${Object.keys(existingPosts).length} existing posts in Notion.`);
    console.log();

    console.log('Starting sync...');
    console.log('-'.repeat(50));

    let currentIndex = 0;
    for (const post of posts) {
      currentIndex++;
      const progress = `[${currentIndex}/${posts.length}]`;

      try {
        const existing = existingPosts[post.slug];

        // 先判断是否需要跳过
        if (existing) {
          // 比较 PG 的 modified 和 Notion 的 UpdateDate
          const postModified = new Date(post.modified * 1000).toISOString();

          if (existing.modified && postModified <= existing.modified) {
            // PG 的修改时间不比 Notion 更新，跳过
            console.log(`${progress} [SKIP] "${post.title}" (slug: ${post.slug}) - No update needed`);
            result.skipped++;
            continue;
          }
        }

        // 只有在需要创建或更新时才清理图片链接
        const cleanResult = await cleanBrokenImageLinks(post.text, checkImageLinks);
        const cleanedPost = { ...post, text: cleanResult.content };

        totalImagesChecked += cleanResult.totalChecked;
        totalImagesRemoved += cleanResult.removedCount;
        allBrokenImages.push(...cleanResult.brokenImages);

        if (existing) {
          // PG 的修改时间更新，执行更新
          console.log(`${progress} [UPDATE] "${post.title}" (slug: ${post.slug})`);
          await notionClient.updatePage(existing.pageId, cleanedPost);
          result.updated++;
        } else {
          console.log(`${progress} [CREATE] "${post.title}" (slug: ${post.slug})`);
          await notionClient.createPage(cleanedPost);
          result.created++;
        }

        await sleep(350);
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`${progress} [FAILED] "${post.title}" - ${errorMessage}`);
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
  printSummary(result, 'posts');

  // 打印图片检查统计
  if (checkImageLinks && totalImagesChecked > 0) {
    console.log();
    console.log('Image Check Summary:');

    // 先打印破损图片清单
    if (allBrokenImages.length > 0) {
      console.log();
      console.log('Broken Images:');
      for (const img of allBrokenImages) {
        console.log(`  [IMAGE] ${img.url} - ${img.error || `HTTP ${img.statusCode}`}`);
      }
      console.log();
    }

    // 再打印统计信息
    console.log(`  Total images checked: ${totalImagesChecked}`);
    console.log(`  Total images removed: ${totalImagesRemoved}`);
  }
}

// 同步友链
async function syncLinks(): Promise<void> {
  if (!notionLinksConfig) {
    console.error('Error: NOTION_LINKS_DATABASE_ID is not configured.');
    console.error('Please set NOTION_LINKS_DATABASE_ID in your .env file.');
    process.exit(1);
  }

  const typechoClient = new TypechoClient(typechoDbConfig);
  const notionLinksClient = new NotionLinksClient(notionLinksConfig);

  const result: SyncResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    console.log('\nFetching links...');
    console.log('Connecting to Typecho database...');
    await typechoClient.connect();
    const links = await typechoClient.getLinks();
    await typechoClient.close();

    result.total = links.length;
    console.log(`Total: ${links.length} links`);
    console.log();

    if (links.length === 0) {
      console.log('No links to sync.');
      return;
    }

    console.log('Checking Notion database properties...');
    await notionLinksClient.ensureDatabaseProperties();
    console.log();

    console.log('Querying existing links in Notion...');
    const existingLinks = await notionLinksClient.queryExistingLinks();
    console.log(`Found ${Object.keys(existingLinks).length} existing links in Notion.`);
    console.log();

    console.log('Starting sync...');
    console.log('-'.repeat(50));

    let currentIndex = 0;
    for (const link of links) {
      currentIndex++;
      const progress = `[${currentIndex}/${links.length}]`;

      try {
        const existing = existingLinks[link.url];

        if (existing) {
          console.log(`${progress} [UPDATE] "${link.name}" (url: ${link.url})`);
          await notionLinksClient.updatePage(existing.pageId, link);
          result.updated++;
        } else {
          console.log(`${progress} [CREATE] "${link.name}" (url: ${link.url})`);
          await notionLinksClient.createPage(link);
          result.created++;
        }

        await sleep(350);
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`${progress} [FAILED] "${link.name}" - ${errorMessage}`);
        result.failed++;
        result.errors.push({ title: link.name, error: errorMessage });
      }
    }

    console.log('-'.repeat(50));
    console.log();

  } catch (error) {
    console.error('Sync error:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }

  printSummary(result, 'links');
}

// 导出到 Markdown
async function exportToMarkdown(noCache: boolean, checkImageLinks: boolean, outputDir?: string): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const exportDir = outputDir || markdownExportDir;
  const markdownExporter = new MarkdownExporter(exportDir);

  console.log(`Export directory: ${exportDir}`);
  if (checkImageLinks) {
    console.log('Image link checking is enabled - broken image links will be removed');
  }
  console.log();

  const result: SyncResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // 图片检查统计
  let totalImagesChecked = 0;
  let totalImagesRemoved = 0;
  const allBrokenImages: Array<{ url: string; statusCode?: number; error?: string }> = [];

  let posts: TypechoPost[] = [];

  try {
    console.log('\nFetching posts...');

    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) {
        posts = cached;
      }
    } else {
      console.log('Cache disabled (--no-cache)');
    }

    if (posts.length === 0) {
      console.log('Connecting to Typecho database...');
      await typechoClient.connect();
      posts = await typechoClient.getPosts();
      await typechoClient.close();

      if (posts.length > 0) {
        setCachedPosts(posts);
      }
    }

    result.total = posts.length;
    console.log(`Total: ${posts.length} posts`);
    console.log();

    if (posts.length === 0) {
      console.log('No posts to export.');
      return;
    }

    console.log('Starting export to Markdown...');
    console.log('-'.repeat(50));

    let currentIndex = 0;
    for (const post of posts) {
      currentIndex++;
      const progress = `[${currentIndex}/${posts.length}]`;

      try {
        // 先判断是否需要跳过（不实际写入）
        const { action, filename } = await markdownExporter.exportPost(post);

        if (action === 'skipped') {
          console.log(`${progress} [SKIP] "${post.title}" -> ${filename} - No update needed`);
          result.skipped++;
          continue;
        }

        // 只有在需要创建或更新时才清理图片链接
        const cleanResult = await cleanBrokenImageLinks(post.text, checkImageLinks);
        const cleanedPost = { ...post, text: cleanResult.content };

        totalImagesChecked += cleanResult.totalChecked;
        totalImagesRemoved += cleanResult.removedCount;
        allBrokenImages.push(...cleanResult.brokenImages);

        // 重新导出清理后的文章
        await markdownExporter.exportPost(cleanedPost);

        if (action === 'created') {
          console.log(`${progress} [CREATE] "${post.title}" -> ${filename}`);
          result.created++;
        } else if (action === 'updated') {
          console.log(`${progress} [UPDATE] "${post.title}" -> ${filename}`);
          result.updated++;
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(`${progress} [FAILED] "${post.title}" - ${errorMessage}`);
        result.failed++;
        result.errors.push({ title: post.title, error: errorMessage });
      }
    }

    console.log('-'.repeat(50));
    console.log();

  } catch (error) {
    console.error('Export error:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }

  // 打印导出统计
  printSummary(result, 'files');

  // 打印图片检查统计
  if (checkImageLinks && totalImagesChecked > 0) {
    console.log();
    console.log('Image Check Summary:');

    // 先打印破损图片清单
    if (allBrokenImages.length > 0) {
      console.log();
      console.log('Broken Images:');
      for (const img of allBrokenImages) {
        console.log(`  [IMAGE] ${img.url} - ${img.error || `HTTP ${img.statusCode}`}`);
      }
      console.log();
    }

    // 再打印统计信息
    console.log(`  Total images checked: ${totalImagesChecked}`);
    console.log(`  Total images removed: ${totalImagesRemoved}`);
  }
}

// 导出评论到 Remark42 格式
async function exportCommentsToRemark42(
  noCache: boolean,
  siteId: string,
  siteUrl: string,
  outputFile?: string
): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const exportFile = outputFile || './backup-remark42.json';
  const remark42Exporter = new Remark42Exporter(exportFile, siteId, siteUrl);

  console.log(`Site ID: ${siteId}`);
  console.log(`Site URL: ${siteUrl}`);
  console.log(`Output file: ${exportFile}`);
  console.log();

  try {
    console.log('\nFetching posts, pages and comments...');

    let posts: TypechoPost[] = [];

    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) {
        posts = cached;
      }
    } else {
      console.log('Cache disabled (--no-cache)');
    }

    console.log('Connecting to Typecho database...');
    await typechoClient.connect();

    if (posts.length === 0) {
      posts = await typechoClient.getPosts();
      if (posts.length > 0) {
        setCachedPosts(posts);
      }
    }

    // 获取页面
    const pages = await typechoClient.getPages();
    console.log(`Total posts: ${posts.length}`);
    console.log(`Total pages: ${pages.length}`);

    // 合并文章和页面
    const allContents = [...posts, ...pages];
    console.log(`Total contents: ${allContents.length}`);

    // 获取评论
    const comments = await typechoClient.getComments();
    console.log(`Total comments: ${comments.length}`);
    console.log();

    await typechoClient.close();

    if (comments.length === 0) {
      console.log('No comments to export.');
      return;
    }

    console.log('Exporting comments to Remark42 format...');
    console.log('-'.repeat(50));

    await remark42Exporter.exportComments(comments, allContents);

    console.log('-'.repeat(50));
    console.log();

  } catch (error) {
    console.error('Export error:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }

  console.log('='.repeat(50));
  console.log('Export completed!');
  console.log('='.repeat(50));
}

// 导出到 MxSpace
async function exportToMxSpace(noCache: boolean, outputDir?: string): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const exportDir = outputDir || './mxspace-export';
  const mxSpaceExporter = new MxSpaceExporter(exportDir);

  console.log(`Export directory: ${exportDir}`);
  console.log();

  try {
    console.log('\nFetching posts, pages, categories and comments...');

    let posts: TypechoPost[] = [];

    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) {
        posts = cached;
      }
    } else {
      console.log('Cache disabled (--no-cache)');
    }

    console.log('Connecting to Typecho database...');
    await typechoClient.connect();

    if (posts.length === 0) {
      posts = await typechoClient.getPosts();
      if (posts.length > 0) {
        setCachedPosts(posts);
      }
    }

    // 获取页面
    const pages = await typechoClient.getPages();
    console.log(`Total posts: ${posts.length}`);
    console.log(`Total pages: ${pages.length}`);

    // 获取分类
    const categories = await typechoClient.getCategories();
    console.log(`Total categories: ${categories.length}`);

    // 获取评论
    const comments = await typechoClient.getComments();
    console.log(`Total comments: ${comments.length}`);
    console.log();

    await typechoClient.close();

    console.log('Exporting to MxSpace format...');
    console.log('-'.repeat(50));

    await mxSpaceExporter.exportToMxSpace(posts, pages, categories, comments);

    console.log('-'.repeat(50));
    console.log();

  } catch (error) {
    console.error('Export error:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }

  console.log('='.repeat(50));
  console.log('Export completed!');
  console.log('='.repeat(50));
}

// 打印同步统计
function printSummary(result: SyncResult, type: string): void {
  console.log('='.repeat(50));
  console.log('Sync Summary');
  console.log('='.repeat(50));
  console.log(`Total ${type}:   ${result.total}`);
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

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('='.repeat(50));
  console.log('Typecho to Notion Sync Tool');
  console.log('='.repeat(50));
  console.log();

  if (args.clearCache) {
    clearCache();
    if (process.argv.length === 3) {
      return;
    }
  }

  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', (error as Error).message);
    process.exit(1);
  }

  console.log();

  if (args.command === 'links') {
    await syncLinks();
  } else if (args.command === 'markdown') {
    try {
      validateExportConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await exportToMarkdown(args.noCache, args.checkImageLinks, args.outputDir);
  } else if (args.command === 'comments') {
    try {
      validateExportConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }

    // 验证必需参数
    if (!args.siteId) {
      console.error('Error: --site-id is required for comments export');
      console.error('Usage: npm run dev -- comments --site-id=example.com --site-url=https://example.com [--output-file=./backup.json]');
      process.exit(1);
    }
    if (!args.siteUrl) {
      console.error('Error: --site-url is required for comments export');
      console.error('Usage: npm run dev -- comments --site-id=example.com --site-url=https://example.com [--output-file=./backup.json]');
      process.exit(1);
    }

    await exportCommentsToRemark42(args.noCache, args.siteId, args.siteUrl, args.outputFile);
  } else if (args.command === 'mxspace') {
    try {
      validateExportConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await exportToMxSpace(args.noCache, args.outputDir);
  } else {
    await syncPosts(args.noCache, args.skipImageValidation, args.checkImageLinks);
  }
}

// 运行主程序
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
