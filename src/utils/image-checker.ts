import * as https from 'https';
import * as http from 'http';

// 超时时间（30秒）
const TIMEOUT_MS = 30000;

// 并发检查的最大数量
const MAX_CONCURRENT_CHECKS = 10;

// 最大重定向次数
const MAX_REDIRECTS = 3;

// 检查结果接口
export interface ImageCheckResult {
  url: string;
  isValid: boolean;
  statusCode?: number;
  error?: string;
}

// 清理结果接口
export interface CleanResult {
  content: string;
  removedCount: number;
  totalChecked: number;
  brokenImages: ImageCheckResult[];
}

/**
 * 检查图片 URL 是否有效（返回 200 状态码，支持跟随重定向）
 * @param url 图片 URL
 * @param redirectCount 当前重定向次数
 */
export async function checkImageUrl(url: string, redirectCount: number = 0): Promise<ImageCheckResult> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const options = {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
        },
      };

      const req = protocol.get(url, options, (res) => {
        const statusCode = res.statusCode || 0;

        // 检查是否为重定向状态码
        const isRedirect = [301, 302, 307, 308].includes(statusCode);

        if (isRedirect && redirectCount < MAX_REDIRECTS) {
          const location = res.headers.location;

          // 中止当前请求
          res.destroy();

          if (location) {
            // 处理相对路径重定向
            let redirectUrl: string;
            try {
              redirectUrl = new URL(location, url).href;
            } catch {
              redirectUrl = location;
            }

            // 递归跟随重定向
            checkImageUrl(redirectUrl, redirectCount + 1).then(resolve);
            return;
          }

          // 如果没有 location header，视为重定向失败
          resolve({
            url,
            isValid: false,
            statusCode,
            error: `HTTP ${statusCode} (no location)`,
          });
          return;
        }

        // 检查是否为成功状态码
        const isValid = statusCode === 200;

        // 中止请求，不需要接收完整响应
        res.destroy();

        resolve({
          url,
          isValid,
          statusCode,
          error: isValid ? undefined : `HTTP ${statusCode}`,
        });
      });

      req.on('error', (err) => {
        resolve({
          url,
          isValid: false,
          error: err.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          url,
          isValid: false,
          error: 'Timeout (30s)',
        });
      });

    } catch (error) {
      // URL 解析失败
      resolve({
        url,
        isValid: false,
        error: 'Invalid URL',
      });
    }
  });
}

/**
 * 并发控制：限制同时执行的 Promise 数量
 */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const [index, item] of items.entries()) {
    const promise = fn(item).then((result) => {
      results[index] = result;
    });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 从 Markdown 文本中提取所有图片链接
 */
export function extractImageUrls(markdown: string): string[] {
  // 匹配 ![alt](url) 格式
  const imageRegex = /!\[.*?\]\((.*?)\)/g;
  const urls: string[] = [];
  let match;

  while ((match = imageRegex.exec(markdown)) !== null) {
    if (match[1]) {
      urls.push(match[1]);
    }
  }

  return urls;
}

/**
 * 清理 Markdown 中的坏图片链接
 * @param markdown 原始 Markdown 文本
 * @param checkLinks 是否检查图片链接
 * @returns 清理后的 Markdown 文本和统计信息
 */
export async function cleanBrokenImageLinks(
  markdown: string,
  checkLinks: boolean
): Promise<CleanResult> {
  if (!checkLinks) {
    return { content: markdown, removedCount: 0, totalChecked: 0, brokenImages: [] };
  }

  const imageUrls = extractImageUrls(markdown);
  if (imageUrls.length === 0) {
    return { content: markdown, removedCount: 0, totalChecked: 0, brokenImages: [] };
  }

  let cleanedContent = markdown;
  let removedCount = 0;
  const brokenImages: ImageCheckResult[] = [];

  // 并发检查所有图片 URL
  const validityResults = await runWithConcurrencyLimit(
    imageUrls,
    MAX_CONCURRENT_CHECKS,
    async (url) => {
      const result = await checkImageUrl(url);
      return result;
    }
  );

  // 移除失效的图片链接
  for (const result of validityResults) {
    if (!result.isValid) {
      // 移除整个 ![...](...) 语法
      const imagePattern = new RegExp(`!\\\\[.*?\\\\]\\\\(${escapeRegExp(result.url)}\\\\)`, 'g');
      cleanedContent = cleanedContent.replace(imagePattern, '');
      removedCount++;
      brokenImages.push(result);
    }
  }

  return { content: cleanedContent, removedCount, totalChecked: imageUrls.length, brokenImages };
}

/**
 * 转义正则表达式中的特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
