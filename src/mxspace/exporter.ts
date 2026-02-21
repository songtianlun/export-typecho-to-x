import * as fs from 'fs';
import * as path from 'path';
import { serialize } from 'bson';
import { ObjectId } from 'bson';
import { TypechoPost, TypechoComment, TypechoMeta, MxCategory, MxPost, MxPage, MxComment } from '../types';

export class MxSpaceExporter {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * 导出到 MxSpace BSON 格式
   */
  async exportToMxSpace(
    posts: TypechoPost[],
    pages: TypechoPost[],
    categories: TypechoMeta[],
    comments: TypechoComment[]
  ): Promise<void> {
    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // 构建映射关系
    const categoryMap = new Map<string, ObjectId>(); // category slug -> ObjectId
    const categoryNameMap = new Map<string, ObjectId>(); // category name -> ObjectId
    const contentMap = new Map<number, ObjectId>(); // post/page cid -> ObjectId

    // 转换 categories
    const mxCategories: MxCategory[] = [];
    for (const category of categories) {
      const _id = new ObjectId();
      categoryMap.set(category.slug, _id);
      categoryNameMap.set(category.name, _id);

      mxCategories.push({
        _id: _id.toString(),
        name: category.name,
        slug: category.slug,
        type: 0, // MxSpace 中 0 表示分类
        created: new Date(category.order * 1000).toISOString(), // 使用 order 作为时间戳
      });
    }

    // 转换 posts
    const mxPosts: MxPost[] = [];
    for (const post of posts) {
      const _id = new ObjectId();
      contentMap.set(post.cid, _id);

      // 获取分类 ID
      let categoryId = '';
      if (post.categories.length > 0) {
        const catId = categoryNameMap.get(post.categories[0]);
        if (catId) {
          categoryId = catId.toString();
        }
      }

      // 提取图片
      const images = this.extractImages(post.text);

      mxPosts.push({
        _id: _id.toString(),
        created: new Date(post.created * 1000).toISOString(),
        modified: new Date(post.modified * 1000).toISOString(),
        title: post.title,
        text: post.text,
        slug: post.slug,
        categoryId,
        tags: post.tags,
        allowComment: true,
        images,
        count: {
          read: 0,
          like: 0,
        },
      });
    }

    // 转换 pages
    const mxPages: MxPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const _id = new ObjectId();
      contentMap.set(page.cid, _id);

      mxPages.push({
        _id: _id.toString(),
        created: new Date(page.created * 1000).toISOString(),
        modified: new Date(page.modified * 1000).toISOString(),
        title: page.title,
        text: page.text,
        slug: page.slug,
        allowComment: true,
        order: i,
      });
    }

    // 转换 comments
    const mxComments: MxComment[] = [];
    const commentIdMap = new Map<number, ObjectId>(); // typecho coid -> ObjectId

    // 第一遍：创建所有评论的 ObjectId
    for (const comment of comments) {
      const _id = new ObjectId();
      commentIdMap.set(comment.coid, _id);
    }

    // 第二遍：构建评论数据和层级关系
    const childrenMap = new Map<number, number[]>(); // parent coid -> child coids
    const contentTypeMap = new Map<number, 'posts' | 'pages'>(); // cid -> type

    // 记录每个 content 的类型（post 或 page）
    for (const post of posts) {
      contentTypeMap.set(post.cid, 'posts');
    }
    for (const page of pages) {
      contentTypeMap.set(page.cid, 'pages');
    }

    for (const comment of comments) {
      if (comment.parent > 0) {
        if (!childrenMap.has(comment.parent)) {
          childrenMap.set(comment.parent, []);
        }
        childrenMap.get(comment.parent)!.push(comment.coid);
      }
    }

    for (const comment of comments) {
      const _id = commentIdMap.get(comment.coid)!;
      const refId = contentMap.get(comment.cid);
      const refType = contentTypeMap.get(comment.cid);

      if (!refId || !refType) {
        console.warn(`Warning: Content not found for comment ${comment.coid}, skipping...`);
        continue;
      }

      // 获取子评论 IDs
      const children: string[] = [];
      if (childrenMap.has(comment.coid)) {
        for (const childCoid of childrenMap.get(comment.coid)!) {
          const childId = commentIdMap.get(childCoid);
          if (childId) {
            children.push(childId.toString());
          }
        }
      }

      const mxComment: MxComment = {
        _id: _id.toString(),
        ref: refId.toString(),
        refType, // 使用实际的类型：'posts' 或 'pages'
        author: comment.author,
        mail: comment.mail,
        url: comment.url,
        text: comment.text,
        state: comment.status === 'approved' ? 1 : 0,
        children,
        key: '', // 先留空，稍后计算
        created: new Date(comment.created * 1000).toISOString(),
      };

      // 如果有父评论，添加 parent 字段
      if (comment.parent > 0) {
        const parentId = commentIdMap.get(comment.parent);
        if (parentId) {
          mxComment.parent = parentId.toString();
        }
      }

      mxComments.push(mxComment);
    }

    // 第三遍：计算 comment key 和 commentIndex
    this.assignCommentKeys(mxComments, posts, pages);

    // 写入 BSON 文件
    this.writeBsonFile('categories.bson', mxCategories);
    this.writeBsonFile('posts.bson', mxPosts);
    this.writeBsonFile('pages.bson', mxPages);
    this.writeBsonFile('comments.bson', mxComments);

    console.log(`Exported ${mxCategories.length} categories to ${path.join(this.outputDir, 'categories.bson')}`);
    console.log(`Exported ${mxPosts.length} posts to ${path.join(this.outputDir, 'posts.bson')}`);
    console.log(`Exported ${mxPages.length} pages to ${path.join(this.outputDir, 'pages.bson')}`);
    console.log(`Exported ${mxComments.length} comments to ${path.join(this.outputDir, 'comments.bson')}`);
  }

  /**
   * 分配评论的 key 和 commentIndex
   * 格式：顶层评论为 "#1", 子评论为 "#1#1", "#1#2" 等
   */
  private assignCommentKeys(comments: MxComment[], posts: TypechoPost[], pages: TypechoPost[]): void {
    // 为每个 post/page 创建一个评论索引计数器
    const commentsIndexMap = new Map<string, number>();

    // 初始化所有 content 的索引为 0
    for (const post of posts) {
      commentsIndexMap.set(post.cid.toString(), 0);
    }
    for (const page of pages) {
      commentsIndexMap.set(page.cid.toString(), 0);
    }

    // 为每个评论创建一个子评论索引计数器
    const commentIndexMap = new Map<string, number>();

    // 处理评论，按创建时间排序
    const sortedComments = [...comments].sort((a, b) => {
      return new Date(a.created).getTime() - new Date(b.created).getTime();
    });

    for (const comment of sortedComments) {
      if (!comment.parent) {
        // 顶层评论
        const currentIndex = (commentsIndexMap.get(comment.ref) || 0) + 1;
        commentsIndexMap.set(comment.ref, currentIndex);
        comment.key = `#${currentIndex}`;
        commentIndexMap.set(comment._id, 0);
      } else {
        // 子评论
        const parentComment = comments.find(c => c._id === comment.parent);
        if (parentComment) {
          const currentIndex = (commentIndexMap.get(comment.parent) || 0) + 1;
          commentIndexMap.set(comment.parent, currentIndex);
          comment.key = `${parentComment.key}#${currentIndex}`;
          commentIndexMap.set(comment._id, 0);
        }
      }
    }
  }

  /**
   * 提取文章中的图片链接
   */
  private extractImages(text: string): any[] {
    const images: any[] = [];
    const imageRegex = /!\[.*?\]\((.*?)\)/g;
    let match;

    while ((match = imageRegex.exec(text)) !== null) {
      const url = match[1];
      if (url) {
        images.push({
          src: url,
          height: 0,
          width: 0,
          type: 'photo',
        });
      }
    }

    return images;
  }

  /**
   * 写入 BSON 文件
   */
  private writeBsonFile(filename: string, data: any[]): void {
    const filePath = path.join(this.outputDir, filename);
    const buffers: Buffer[] = [];

    for (const item of data) {
      // 将 _id 字符串转换为 ObjectId
      const processedItem = this.convertIdFields(item);
      const serialized = serialize(processedItem);
      const buffer = Buffer.from(serialized);
      buffers.push(buffer);
    }

    const finalBuffer = Buffer.concat(buffers);
    fs.writeFileSync(filePath, finalBuffer);
  }

  /**
   * 递归转换对象中的 _id、categoryId、ref、parent、children 字段为 ObjectId
   */
  private convertIdFields(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertIdFields(item));
    }

    if (obj && typeof obj === 'object') {
      const converted: any = {};

      for (const key in obj) {
        const value = obj[key];

        if (key === '_id' || key === 'categoryId' || key === 'ref' || key === 'parent') {
          // 单个 ID 字段
          if (value && typeof value === 'string' && ObjectId.isValid(value)) {
            converted[key] = new ObjectId(value);
          } else {
            converted[key] = value;
          }
        } else if (key === 'children' && Array.isArray(value)) {
          // children 是 ID 数组
          converted[key] = value.map(id => {
            if (typeof id === 'string' && ObjectId.isValid(id)) {
              return new ObjectId(id);
            }
            return id;
          });
        } else {
          converted[key] = this.convertIdFields(value);
        }
      }

      return converted;
    }

    return obj;
  }
}
