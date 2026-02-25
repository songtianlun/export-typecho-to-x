import { TypechoClient } from './typecho/client';
import { typechoDbConfig } from './config';
import { TypechoPost } from './types';
import { getCachedPosts, setCachedPosts, getCachedPages, setCachedPages } from './cache';

interface CheckResult {
  oldUrl: string;
  newUrl: string;
  success: boolean;
  error?: string;
}

// 并发控制器 - 即时输出版本
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const total = items.length;

  async function worker(): Promise<void> {
    while (index < total) {
      const currentIndex = index++;
      await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array(Math.min(concurrency, total))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
}

// 延迟函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 检查单个 URL（带重试）
async function checkUrl(oldUrl: string, newUrl: string, maxRetries: number = 3): Promise<CheckResult> {
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(newUrl, {
        method: 'HEAD',
        redirect: 'follow',
      });

      if (response.ok) {
        return { oldUrl, newUrl, success: true };
      } else {
        // HTTP 错误不重试（如 404）
        return { oldUrl, newUrl, success: false, error: `${response.status}` };
      }
    } catch (error) {
      lastError = (error as Error).message;
      if (attempt < maxRetries) {
        await sleep(3000);
      }
    }
  }

  return { oldUrl, newUrl, success: false, error: lastError };
}

// 主检查函数
export async function checkMapping(oldDomain: string, newDomain: string, noCache: boolean = false): Promise<void> {
  oldDomain = oldDomain.replace(/\/+$/, '');
  newDomain = newDomain.replace(/\/+$/, '');

  console.log(`检查页面映射: ${oldDomain} -> ${newDomain}`);
  console.log('-'.repeat(60));

  const typechoClient = new TypechoClient(typechoDbConfig);

  let posts: TypechoPost[] = [];
  let pages: TypechoPost[] = [];
  let routingTable: { post: string; page: string };

  try {
    // 尝试从缓存获取
    if (!noCache) {
      const cachedPosts = getCachedPosts();
      const cachedPages = getCachedPages();
      if (cachedPosts) posts = cachedPosts;
      if (cachedPages) pages = cachedPages;
    } else {
      console.log('缓存已禁用 (--no-cache)');
    }

    console.log('连接数据库...');
    await typechoClient.connect();

    // 获取路由配置
    routingTable = await typechoClient.getRoutingTable();
    console.log(`文章路由: ${routingTable.post}`);
    console.log(`页面路由: ${routingTable.page}`);

    // 如果缓存未命中，从数据库获取
    if (posts.length === 0) {
      console.log('获取文章列表...');
      posts = await typechoClient.getPosts();
      if (posts.length > 0) setCachedPosts(posts);
    }
    if (pages.length === 0) {
      console.log('获取页面列表...');
      pages = await typechoClient.getPages();
      if (pages.length > 0) setCachedPages(pages);
    }

    console.log(`文章: ${posts.length}, 页面: ${pages.length}`);

    // 生成 URL 对
    const urlPairs: Array<{ oldUrl: string; newUrl: string }> = [];

    for (const post of posts) {
      const path = typechoClient.generateUrl(routingTable.post, post);
      urlPairs.push({
        oldUrl: `${oldDomain}${path}`,
        newUrl: `${newDomain}${path}`,
      });
    }

    for (const page of pages) {
      const path = typechoClient.generateUrl(routingTable.page, page);
      urlPairs.push({
        oldUrl: `${oldDomain}${path}`,
        newUrl: `${newDomain}${path}`,
      });
    }

    await typechoClient.close();

    const total = urlPairs.length;
    console.log(`共 ${total} 个页面需要检查\n`);

    if (total === 0) {
      console.log('没有需要检查的页面。');
      return;
    }

    // 统计
    let passed = 0;
    let failed = 0;
    const failedResults: CheckResult[] = [];

    // 并发检查 - 即时输出（并发20，带重试）
    await runWithConcurrency(urlPairs, 20, async ({ oldUrl, newUrl }, idx) => {
      const result = await checkUrl(oldUrl, newUrl);

      if (result.success) {
        passed++;
        console.log(`[${idx + 1}/${total}] ${result.newUrl} [OK]`);
      } else {
        failed++;
        failedResults.push(result);
        console.log(`[${idx + 1}/${total}] ${result.newUrl} [FAIL: ${result.error}]`);
      }
    });

    // 打印统计
    console.log('-'.repeat(60));
    console.log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`);

    if (failedResults.length > 0) {
      console.log('\n失败列表:');
      for (const result of failedResults) {
        console.log(`  ${result.newUrl} [${result.error}]`);
      }
    }
  } catch (error) {
    console.error('错误:', (error as Error).message);
    await typechoClient.close();
    throw error;
  }
}
