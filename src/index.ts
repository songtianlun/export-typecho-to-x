import { validateConfig, validateExportConfig, validateMxSpaceApiConfig, notionConfig, notionLinksConfig, typechoDbConfig, markdownExportDir, mxSpaceApiConfig } from './config';
import { TypechoClient } from './typecho/client';
import { NotionClient } from './notion/client';
import { NotionLinksClient } from './notion/links-client';
import { MarkdownExporter } from './markdown/exporter';
import { Remark42Exporter } from './remark42/exporter';
import { MxSpaceExporter } from './mxspace/exporter';
import { MxSpaceApiClient } from './mxspace/api-client';
import { SyncResult, TypechoPost } from './types';
import { getCachedPosts, setCachedPosts, clearCache } from './cache';
import { cleanBrokenImageLinks } from './utils/image-checker';
import { checkMapping } from './check-mapping';

// 解析命令行参数
function parseArgs(): {
  noCache: boolean;
  clearCache: boolean;
  skipImageValidation: boolean;
  checkImageLinks: boolean;
  command: 'posts' | 'links' | 'markdown' | 'comments' | 'mxspace' | 'mxspace-api' | 'mxspace-comments' | 'mxspace-links' | 'check-mapping';
  outputDir?: string;
  outputFile?: string;
  siteId?: string;
  siteUrl?: string;
  oldDomain?: string;
  newDomain?: string;
} {
  const args = process.argv.slice(2);
  let command: 'posts' | 'links' | 'markdown' | 'comments' | 'mxspace' | 'mxspace-api' | 'mxspace-comments' | 'mxspace-links' | 'check-mapping' = 'posts';
  let outputDir: string | undefined;
  let outputFile: string | undefined;
  let siteId: string | undefined;
  let siteUrl: string | undefined;
  let oldDomain: string | undefined;
  let newDomain: string | undefined;

  if (args.includes('check-mapping')) {
    command = 'check-mapping';
    // 解析位置参数：check-mapping <oldDomain> <newDomain>
    const idx = args.indexOf('check-mapping');
    if (args[idx + 1] && !args[idx + 1].startsWith('-')) {
      oldDomain = args[idx + 1];
    }
    if (args[idx + 2] && !args[idx + 2].startsWith('-')) {
      newDomain = args[idx + 2];
    }
  } else if (args.includes('links')) {
    command = 'links';
  } else if (args.includes('markdown') || args.includes('export')) {
    command = 'markdown';
  } else if (args.includes('comments')) {
    command = 'comments';
  } else if (args.includes('mxspace-links')) {
    command = 'mxspace-links';
  } else if (args.includes('mxspace-comments')) {
    command = 'mxspace-comments';
  } else if (args.includes('mxspace-api')) {
    command = 'mxspace-api';
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
    oldDomain,
    newDomain,
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

// 通过 API 导入到 MxSpace
async function importToMxSpaceApi(noCache: boolean): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const apiClient = new MxSpaceApiClient(mxSpaceApiConfig.apiUrl!, mxSpaceApiConfig.apiKey!);

  const result: SyncResult = {
    total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [],
  };

  try {
    console.log('\nFetching data from Typecho...');
    await typechoClient.connect();

    let posts: TypechoPost[] = [];
    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) posts = cached;
    }
    if (posts.length === 0) {
      posts = await typechoClient.getPosts();
      if (posts.length > 0) setCachedPosts(posts);
    }

    const pages = await typechoClient.getPages();
    const categories = await typechoClient.getCategories();
    const comments = await typechoClient.getComments();
    await typechoClient.close();

    console.log(`Posts: ${posts.length}, Pages: ${pages.length}, Categories: ${categories.length}, Comments: ${comments.length}\n`);

    const categoryNameToId = new Map<string, string>();
    const cidToId = new Map<number, { id: string; type: 'Post' | 'Page' }>();
    const coidToId = new Map<number, string>();

    // 1. 获取/创建分类
    console.log('Syncing categories...');
    const existingCategories = await apiClient.getCategories();

    // 确保有默认分类
    let defaultCategoryId = existingCategories.get('未分类');
    if (!defaultCategoryId) {
      try {
        defaultCategoryId = await apiClient.createCategory('未分类', 'uncategorized');
        console.log(`  [OK] 未分类 (default)`);
      } catch (e) {
        console.log(`  [FAIL] 未分类: ${(e as Error).message}`);
      }
    } else {
      console.log(`  [EXIST] 未分类 (default)`);
    }

    for (const cat of categories) {
      const existingId = existingCategories.get(cat.name);
      if (existingId) {
        categoryNameToId.set(cat.name, existingId);
        console.log(`  [EXIST] ${cat.name}`);
        result.skipped++;
      } else {
        try {
          const id = await apiClient.createCategory(cat.name, cat.slug);
          categoryNameToId.set(cat.name, id);
          console.log(`  [OK] ${cat.name}`);
          result.created++;
        } catch (e) {
          console.log(`  [FAIL] ${cat.name}: ${(e as Error).message}`);
          result.failed++;
        }
        await sleep(300);
      }
    }

    // 2. 创建文章
    console.log('\nSyncing posts...');
    const existingPosts = await apiClient.getPosts();
    for (const post of posts) {
      const existingId = existingPosts.get(post.slug);
      if (existingId) {
        cidToId.set(post.cid, { id: existingId, type: 'Post' });
        result.skipped++;
      } else {
        const categoryId = categoryNameToId.get(post.categories[0] || '') || defaultCategoryId;
        if (!categoryId) {
          console.log(`  [SKIP] ${post.title}: no valid category`);
          result.skipped++;
          continue;
        }
        try {
          const id = await apiClient.createPost(post, categoryId);
          cidToId.set(post.cid, { id, type: 'Post' });
          console.log(`  [OK] ${post.title}`);
          result.created++;
        } catch (e) {
          console.log(`  [FAIL] ${post.title}: ${(e as Error).message}`);
          result.failed++;
        }
        await sleep(300);
      }
    }
    console.log(`  Skipped ${result.skipped} existing posts`);

    // 3. 创建页面
    console.log('\nSyncing pages...');
    const existingPages = await apiClient.getPages();
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const existingId = existingPages.get(page.slug);
      if (existingId) {
        cidToId.set(page.cid, { id: existingId, type: 'Page' });
        console.log(`  [EXIST] ${page.title}`);
        result.skipped++;
      } else {
        try {
          const id = await apiClient.createPage(page, i);
          cidToId.set(page.cid, { id, type: 'Page' });
          console.log(`  [OK] ${page.title}`);
          result.created++;
        } catch (e) {
          console.log(`  [FAIL] ${page.title}: ${(e as Error).message}`);
          result.failed++;
        }
        await sleep(300);
      }
    }

    // 4. 创建评论 - 使用 mxspace-comments 命令直接导入 MongoDB
    console.log('\n[INFO] Use "mxspace-comments" command to import comments directly to MongoDB.');
    console.log('       This preserves original timestamps. Run: npm run dev -- mxspace-comments');

    result.total = categories.length + posts.length + pages.length;
  } catch (error) {
    console.error('Import error:', (error as Error).message);
    throw error;
  }

  printSummary(result, 'items');
}

// 通过 MongoDB 直接导入评论到 MxSpace
async function importMxSpaceComments(noCache: boolean): Promise<void> {
  const { MongoClient, ObjectId } = await import('mongodb');
  const typechoClient = new TypechoClient(typechoDbConfig);
  const apiClient = new MxSpaceApiClient(mxSpaceApiConfig.apiUrl!, mxSpaceApiConfig.apiKey!);

  const result: SyncResult = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const mongo = new MongoClient(mxSpaceApiConfig.mongoUri);
  await mongo.connect();
  const db = mongo.db();
  const commentsCol = db.collection('comments');

  try {
    console.log('\nFetching data...');
    await typechoClient.connect();

    let posts: TypechoPost[] = [];
    if (!noCache) {
      const cached = getCachedPosts();
      if (cached) posts = cached;
    }
    if (posts.length === 0) {
      posts = await typechoClient.getPosts();
      if (posts.length > 0) setCachedPosts(posts);
    }

    const pages = await typechoClient.getPages();
    const comments = await typechoClient.getComments();
    await typechoClient.close();

    console.log(`Posts: ${posts.length}, Pages: ${pages.length}, Comments: ${comments.length}\n`);

    // Build slug → ObjectId mapping from MxSpace API
    console.log('Fetching MxSpace posts/pages...');
    const mxPosts = await apiClient.getPosts();
    const mxPages = await apiClient.getPages();

    // Build Typecho cid → MxSpace ref mapping
    const cidToRef = new Map<number, { id: string; type: 'posts' | 'pages' }>();
    for (const post of posts) {
      const mxId = mxPosts.get(post.slug);
      if (mxId) cidToRef.set(post.cid, { id: mxId, type: 'posts' });
    }
    for (const page of pages) {
      const mxId = mxPages.get(page.slug);
      if (mxId) cidToRef.set(page.cid, { id: mxId, type: 'pages' });
    }

    // Group comments by ref
    const commentsByRef = new Map<string, typeof comments>();
    for (const c of comments) {
      const ref = cidToRef.get(c.cid);
      if (!ref) continue;
      const key = `${ref.type}:${ref.id}`;
      if (!commentsByRef.has(key)) commentsByRef.set(key, []);
      commentsByRef.get(key)!.push(c);
    }

    console.log('\nImporting comments to MongoDB...');
    const coidToOid = new Map<number, string>();
    const coidToKey = new Map<number, string>();
    const coidToCommentsIndex = new Map<number, number>(); // 每个评论的子评论计数

    for (const [key, refComments] of commentsByRef) {
      const [refType, refId] = key.split(':') as ['posts' | 'pages', string];
      const topComments = refComments.filter(c => c.parent === 0).sort((a, b) => a.created - b.created);
      const childComments = refComments.filter(c => c.parent !== 0).sort((a, b) => a.created - b.created);

      let refCommentsIndex = 0; // 文章/页面级别的评论计数
      for (const c of topComments) {
        refCommentsIndex++;
        const keyStr = `#${refCommentsIndex}`;
        const doc = {
          _id: new ObjectId(),
          ref: new ObjectId(refId),
          refType,
          author: c.author || 'Anonymous',
          mail: c.mail || 'anonymous@example.com',
          ...(c.url ? { url: c.url } : {}),
          text: c.text,
          state: c.status === 'approved' ? 1 : 0,
          children: [] as any[],
          key: keyStr,
          created: new Date(c.created * 1000),
          commentsIndex: 1, // 子评论计数，初始为1
          ip: c.ip || '',
          agent: c.agent || '',
          location: 'Unknown',
          pin: false,
          isWhispers: false,
        };
        try {
          await commentsCol.insertOne(doc);
          coidToOid.set(c.coid, doc._id.toString());
          coidToKey.set(c.coid, keyStr);
          coidToCommentsIndex.set(c.coid, 1);
          console.log(`  [OK] Comment #${c.coid} -> ${keyStr}`);
          result.created++;
        } catch (e) {
          console.log(`  [FAIL] Comment #${c.coid}: ${(e as Error).message}`);
          result.failed++;
        }
      }

      for (const c of childComments) {
        const parentOid = coidToOid.get(c.parent);
        const parentKey = coidToKey.get(c.parent);
        if (!parentOid || !parentKey) continue;

        // 先用父评论当前的 commentsIndex 生成 key，然后递增
        const parentIdx = coidToCommentsIndex.get(c.parent) || 1;
        const keyStr = `${parentKey}#${parentIdx}`;
        coidToCommentsIndex.set(c.parent, parentIdx + 1);
        const doc = {
          _id: new ObjectId(),
          ref: new ObjectId(refId),
          refType,
          author: c.author || 'Anonymous',
          mail: c.mail || 'anonymous@example.com',
          ...(c.url ? { url: c.url } : {}),
          text: c.text,
          state: c.status === 'approved' ? 1 : 0,
          children: [] as any[],
          parent: new ObjectId(parentOid),
          key: keyStr,
          created: new Date(c.created * 1000),
          commentsIndex: 1, // 子评论计数，初始为1
          ip: c.ip || '',
          agent: c.agent || '',
          location: 'Unknown',
          pin: false,
          isWhispers: false,
        };
        try {
          await commentsCol.insertOne(doc);
          // 更新父评论的 commentsIndex 到数据库
          await commentsCol.updateOne(
            { _id: new ObjectId(parentOid) },
            { $push: { children: doc._id }, $set: { commentsIndex: parentIdx + 1 } } as any
          );
          coidToOid.set(c.coid, doc._id.toString());
          coidToKey.set(c.coid, keyStr);
          coidToCommentsIndex.set(c.coid, 0);
          console.log(`  [OK] Reply #${c.coid} -> ${keyStr}`);
          result.created++;
        } catch (e) {
          console.log(`  [FAIL] Reply #${c.coid}: ${(e as Error).message}`);
          result.failed++;
        }
      }
    }

    result.total = comments.length;
  } finally {
    await mongo.close();
  }

  printSummary(result, 'comments');
}

// 通过 API 导入友链到 MxSpace
async function importMxSpaceLinks(): Promise<void> {
  const typechoClient = new TypechoClient(typechoDbConfig);
  const apiClient = new MxSpaceApiClient(mxSpaceApiConfig.apiUrl!, mxSpaceApiConfig.apiKey!);

  const result: SyncResult = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  try {
    console.log('\nFetching links from Typecho...');
    await typechoClient.connect();
    const links = await typechoClient.getLinks();
    await typechoClient.close();

    result.total = links.length;
    console.log(`Total: ${links.length} links\n`);

    if (links.length === 0) {
      console.log('No links to import.');
      return;
    }

    console.log('Fetching existing links from MxSpace...');
    const existingLinks = await apiClient.getLinks();
    console.log(`Found ${existingLinks.size} existing links\n`);

    console.log('Importing links...');
    console.log('-'.repeat(50));

    const normalizeUrl = (url: string) => url.replace(/\/+$/, '');
    const seen = new Set<string>();

    for (const link of links) {
      const normalizedUrl = normalizeUrl(link.url);

      if (seen.has(normalizedUrl)) {
        console.log(`  [SKIP] ${link.name} - duplicate in source`);
        result.skipped++;
        continue;
      }
      seen.add(normalizedUrl);

      if (existingLinks.has(normalizedUrl)) {
        console.log(`  [SKIP] ${link.name} - already exists`);
        result.skipped++;
        continue;
      }

      // sort: good/ten -> Collection(1), one/others -> Friend(0)
      const type = (link.sort === 'good' || link.sort === 'ten') ? 1 : 0;
      try {
        await apiClient.createLink({
          name: link.name,
          url: link.url,
          avatar: link.image || undefined,
          description: link.description || undefined,
          type,
        });
        console.log(`  [OK] ${link.name}`);
        result.created++;
      } catch (e) {
        console.log(`  [FAIL] ${link.name}: ${(e as Error).message}`);
        result.failed++;
      }
      await sleep(300);
    }

    console.log('-'.repeat(50));
  } catch (error) {
    console.error('Import error:', (error as Error).message);
    throw error;
  }

  printSummary(result, 'links');
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
  } else if (args.command === 'mxspace-api') {
    try {
      validateExportConfig();
      validateMxSpaceApiConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await importToMxSpaceApi(args.noCache);
  } else if (args.command === 'mxspace-comments') {
    try {
      validateExportConfig();
      validateMxSpaceApiConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await importMxSpaceComments(args.noCache);
  } else if (args.command === 'mxspace-links') {
    try {
      validateExportConfig();
      validateMxSpaceApiConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await importMxSpaceLinks();
  } else if (args.command === 'mxspace') {
    try {
      validateExportConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await exportToMxSpace(args.noCache, args.outputDir);
  } else if (args.command === 'check-mapping') {
    if (!args.oldDomain || !args.newDomain) {
      console.error('Error: 需要提供旧域名和新域名');
      console.error('Usage: npm start check-mapping <旧域名> <新域名>');
      console.error('Example: npm start check-mapping https://old-blog.com https://new-blog.com');
      process.exit(1);
    }
    try {
      validateExportConfig();
    } catch (error) {
      console.error('Configuration error:', (error as Error).message);
      process.exit(1);
    }
    await checkMapping(args.oldDomain, args.newDomain, args.noCache);
  } else {
    await syncPosts(args.noCache, args.skipImageValidation, args.checkImageLinks);
  }
}

// 运行主程序
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
