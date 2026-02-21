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

      if (!refId) {
        console.warn(`Warning: Content not found for comment ${comment.coid}, skipping...`);
        continue;
      }

      // 计算评论层级 key (如 "0.1.2")
      const key = this.calculateCommentKey(comment.coid, comment.parent, comments);

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
        refType: 'Post', // 假设都是 Post，如果需要区分可以根据 contentMap 来判断
        author: comment.author,
        mail: comment.mail,
        url: comment.url,
        text: comment.text,
        state: comment.status === 'approved' ? 1 : 0,
        children,
        key,
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
   * 计算评论的层级 key
   * 格式如：顶层评论为 "0", 第一层子评论为 "0.1", 第二层为 "0.1.1"
   */
  private calculateCommentKey(coid: number, parent: number, allComments: TypechoComment[]): string {
    if (parent === 0) {
      return '0';
    }

    // 找到父评论
    const parentComment = allComments.find(c => c.coid === parent);
    if (!parentComment) {
      return '0';
    }

    // 递归获取父评论的 key
    const parentKey = this.calculateCommentKey(parent, parentComment.parent, allComments);

    // 计算当前评论在同级评论中的位置
    const siblings = allComments.filter(c => c.parent === parent);
    const index = siblings.findIndex(c => c.coid === coid);

    return `${parentKey}.${index + 1}`;
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
