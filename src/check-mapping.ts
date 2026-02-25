import { TypechoClient } from './typecho/client';
import { typechoDbConfig } from './config';
import { TypechoPost } from './types';

interface CheckResult {
  oldUrl: string;
  newUrl: string;
  success: boolean;
  error?: string;
}

// 并发控制器
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
    });

    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      for (let i = executing.length - 1; i >= 0; i--) {
        const status = await Promise.race([
          executing[i].then(() => 'fulfilled'),
          Promise.resolve('pending'),
        ]);
        if (status === 'fulfilled') {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// 检查单个 URL
async function checkUrl(oldUrl: string, newUrl: string): Promise<CheckResult> {
  try {
    const response = await fetch(newUrl, {
      method: 'HEAD',
      redirect: 'follow',
    });

    if (response.ok) {
      return { oldUrl, newUrl, success: true };
    } else {
      return { oldUrl, newUrl, success: false, error: `${response.status}` };
    }
  } catch (error) {
    return { oldUrl, newUrl, success: false, error: (error as Error).message };
  }
}

// 主检查函数
export async function checkMapping(oldDomain: string, newDomain: string): Promise<void> {
  oldDomain = oldDomain.replace(/\/+$/, '');
  newDomain = newDomain.replace(/\/+$/, '');

  console.log(`检查页面映射: ${oldDomain} -> ${newDomain}`);
  console.log('-'.repeat(60));

  const typechoClient = new TypechoClient(typechoDbConfig);

  let posts: TypechoPost[] = [];
  let pages: TypechoPost[] = [];
  let routingTable: { post: string; page: string };

  try {
    console.log('连接数据库...');
    await typechoClient.connect();

    // 获取路由配置
    routingTable = await typechoClient.getRoutingTable();
    console.log(`文章路由: ${routingTable.post}`);
    console.log(`页面路由: ${routingTable.page}`);

    posts = await typechoClient.getPosts();
    pages = await typechoClient.getPages();

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
    let checked = 0;
    let passed = 0;
    let failed = 0;
    const failedResults: CheckResult[] = [];

    // 并发检查
    const checkTasks = urlPairs.map(({ oldUrl, newUrl }) => async () => {
      const result = await checkUrl(oldUrl, newUrl);
      checked++;

      if (result.success) {
        passed++;
        console.log(`${result.oldUrl} -> ${result.newUrl} [OK]`);
      } else {
        failed++;
        failedResults.push(result);
        console.log(`${result.oldUrl} -> ${result.newUrl} [FAIL: ${result.error}]`);
      }

      return result;
    });

    await runWithConcurrency(checkTasks, 5, (task) => task());

    // 打印统计
    console.log('-'.repeat(60));
    console.log(`总计: ${total} | 检查: ${checked} | 通过: ${passed} | 失败: ${failed}`);

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
