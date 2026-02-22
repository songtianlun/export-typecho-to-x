import { TypechoPost, TypechoComment } from '../types';

export class MxSpaceApiClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getCategories(): Promise<Map<string, string>> {
    const res = await this.request<any>('GET', '/categories');
    const map = new Map<string, string>();
    const data = res.data?.data || res.data || res;
    for (const cat of Array.isArray(data) ? data : []) {
      map.set(cat.name, cat._id || cat.id);
    }
    return map;
  }

  async getPages(): Promise<Map<string, string>> {
    const res = await this.request<any>('GET', '/pages');
    const map = new Map<string, string>();
    const data = res.data?.data || res.data || res;
    for (const page of Array.isArray(data) ? data : []) {
      map.set(page.slug, page._id || page.id);
    }
    return map;
  }

  async getPosts(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let page = 1;
    while (true) {
      const res = await this.request<any>('GET', `/posts?size=50&page=${page}`);
      const data = res.data?.data || res.data || res;
      const items = Array.isArray(data) ? data : [];
      if (items.length === 0) break;
      for (const post of items) {
        map.set(post.slug, post._id || post.id);
      }
      if (items.length < 50) break;
      page++;
    }
    return map;
  }

  async createCategory(name: string, slug: string): Promise<string> {
    const res = await this.request<any>('POST', '/categories', { name, slug, type: 0 });
    return res._id || res.id;
  }

  async createPost(post: TypechoPost, categoryId: string): Promise<string> {
    const isPublished = post.status === 'publish';
    const body = {
      title: post.title,
      text: post.text,
      slug: post.slug,
      categoryId,
      tags: post.tags,
      allowComment: true,
      created: new Date(post.created * 1000).toISOString(),
      modified: new Date(post.modified * 1000).toISOString(),
      isPublished,
    };
    const res = await this.request<any>('POST', '/posts', body);
    return res._id || res.id;
  }

  async createPage(page: TypechoPost, order: number): Promise<string> {
    const body = {
      title: page.title,
      text: page.text,
      slug: page.slug,
      allowComment: true,
      order,
      created: new Date(page.created * 1000).toISOString(),
      modified: new Date(page.modified * 1000).toISOString(),
    };
    const res = await this.request<any>('POST', '/pages', body);
    return res._id || res.id;
  }

  private cleanUrl(url: string): string {
    if (!url || !url.match(/^https?:\/\/.+\..+/)) return '';
    return url;
  }

  private cleanMail(mail: string): string {
    if (!mail || !mail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'anonymous@example.com';
    return mail;
  }

  async createComment(refId: string, refType: 'Post' | 'Page', comment: TypechoComment): Promise<string> {
    const url = this.cleanUrl(comment.url);
    const body: any = {
      text: comment.text,
      source: comment.author || 'Anonymous',
    };
    if (url) body.url = url;
    const res = await this.request<any>('POST', `/comments/owner/comment/${refId}`, body);
    return res._id || res.id;
  }

  async replyComment(commentId: string, comment: TypechoComment): Promise<string> {
    const url = this.cleanUrl(comment.url);
    const body: any = {
      text: comment.text,
      source: comment.author || 'Anonymous',
    };
    if (url) body.url = url;
    const res = await this.request<any>('POST', `/comments/owner/reply/${commentId}`, body);
    return res._id || res.id;
  }
}
