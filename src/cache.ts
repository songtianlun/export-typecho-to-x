import * as fs from 'fs';
import * as path from 'path';
import { TypechoPost } from './types';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'posts.json');
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CacheData {
  timestamp: number;
  ttl: number;
  posts: TypechoPost[];
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function getCachedPosts(): TypechoPost[] | null {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const data: CacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    const now = Date.now();
    const age = now - data.timestamp;

    if (age > data.ttl) {
      console.log(`Cache expired (age: ${Math.round(age / 1000 / 60)} min)`);
      return null;
    }

    const remainingMin = Math.round((data.ttl - age) / 1000 / 60);
    console.log(`Using cached posts (expires in ${remainingMin} min)`);
    return data.posts;
  } catch (error) {
    console.log('Cache read error, will fetch from database');
    return null;
  }
}

export function setCachedPosts(posts: TypechoPost[], ttl: number = DEFAULT_TTL): void {
  ensureCacheDir();

  const data: CacheData = {
    timestamp: Date.now(),
    ttl,
    posts,
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  console.log(`Cached ${posts.length} posts (TTL: ${ttl / 1000 / 60} min)`);
}

export function clearCache(): void {
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
    console.log('Cache cleared');
  }
}
