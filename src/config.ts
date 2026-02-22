import * as dotenv from 'dotenv';
import { DatabaseConfig, NotionConfig } from './types';

// 加载 .env 文件
dotenv.config();

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvOptional(key: string): string | undefined {
  return process.env[key];
}

// Notion 配置（可能不存在，用于导出场景）
export const notionConfig: NotionConfig = {
  apiKey: getEnvOptional('NOTION_KEY') || '',
  databaseId: getEnvOptional('NOTION_DATABASE_ID') || '',
};

// Notion 友链数据库配置（可选）
export const notionLinksConfig: NotionConfig | null = process.env.NOTION_LINKS_DATABASE_ID
  ? {
      apiKey: getEnvOptional('NOTION_KEY') || '',
      databaseId: process.env.NOTION_LINKS_DATABASE_ID,
    }
  : null;

// Typecho 数据库配置
export const typechoDbConfig: DatabaseConfig = {
  host: getEnvOrThrow('TYPECHO_DB_HOST'),
  port: parseInt(getEnvOrDefault('TYPECHO_DB_PORT', '5432'), 10),
  user: getEnvOrThrow('TYPECHO_DB_USER'),
  password: getEnvOrThrow('TYPECHO_DB_PASSWORD'),
  database: getEnvOrThrow('TYPECHO_DB_DATABASE'),
  prefix: getEnvOrDefault('TYPECHO_DB_PREFIX', 'typecho_'),
};

// 数据库适配器（目前仅支持 postgresql）
export const dbAdapter = getEnvOrDefault('TYPECHO_DB_ADAPTER', 'postgresql');

// Markdown 导出目录配置
export const markdownExportDir = getEnvOrDefault('MARKDOWN_EXPORT_DIR', './posts');

// MxSpace API 配置
export const mxSpaceApiConfig = {
  apiUrl: getEnvOptional('MXSPACE_API_URL'),
  apiKey: getEnvOptional('MXSPACE_API_KEY'),
  mongoUri: getEnvOrDefault('MXSPACE_MONGO_URI', 'mongodb://127.0.0.1:27017/mx-space'),
};

// 验证 MxSpace API 配置
export function validateMxSpaceApiConfig(): void {
  if (!mxSpaceApiConfig.apiUrl || !mxSpaceApiConfig.apiKey) {
    throw new Error('Missing MxSpace API configuration. Please set MXSPACE_API_URL and MXSPACE_API_KEY in your .env file.');
  }
  console.log('MxSpace API Configuration:');
  console.log(`  - API URL: ${mxSpaceApiConfig.apiUrl}`);
  console.log(`  - API Key: ${mxSpaceApiConfig.apiKey.substring(0, 8)}...`);
}

// 验证配置
export function validateConfig(): void {
  if (!notionConfig.apiKey || !notionConfig.databaseId) {
    throw new Error('Missing required Notion configuration. Please set NOTION_KEY and NOTION_DATABASE_ID in your .env file.');
  }

  if (dbAdapter !== 'postgresql') {
    throw new Error(`Unsupported database adapter: ${dbAdapter}. Currently only 'postgresql' is supported.`);
  }

  console.log('Configuration loaded successfully:');
  console.log(`  - Notion Database ID: ${notionConfig.databaseId.substring(0, 8)}...`);
  console.log(`  - Typecho DB: ${typechoDbConfig.host}:${typechoDbConfig.port}/${typechoDbConfig.database}`);
  console.log(`  - Table Prefix: ${typechoDbConfig.prefix}`);
}

// 验证导出配置
export function validateExportConfig(): void {
  console.log('Configuration loaded successfully:');
  console.log(`  - Markdown Export Dir: ${markdownExportDir}`);
  console.log(`  - Typecho DB: ${typechoDbConfig.host}:${typechoDbConfig.port}/${typechoDbConfig.database}`);
  console.log(`  - Table Prefix: ${typechoDbConfig.prefix}`);
}
