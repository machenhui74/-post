import { marked } from "marked";

/** 扩展填编辑器时需要 HTML；中间态保持 Markdown。 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}
