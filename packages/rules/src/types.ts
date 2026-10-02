import type { PlatformId } from "@geopost/shared";

export interface FieldLimit {
  min: number;
  max: number;
  recommendMin?: number;
  recommendMax?: number;
  required?: boolean;
}

export interface CoverRule {
  required: boolean;
  minCount: number;
  maxCount: number;
  ratio: string;
  mustBeInBody: boolean;
}

export type PlatformKind = "publish" | "checklist";

/** AI 更容易抽取的内容块；validate 只警告不硬拦。 */
export type ExtractBlock = "definition" | "numbers" | "comparison" | "howto" | "boundary" | "faq";

export interface PlatformRule {
  id: PlatformId;
  label: string;
  /** publish=后台发文；checklist=只打开维护页，不自动提交。 */
  kind: PlatformKind;
  loginUrl: string;
  editorUrl: string;
  checklist?: string[];
  title: FieldLimit;
  body: FieldLimit;
  summary: FieldLimit;
  cover: CoverRule;
  categories: string[];
  supports: {
    aiDeclaration: boolean;
    original: boolean;
    firstPublish: boolean;
    exclusive: boolean;
  };
  styleHint: string;
  geoOrder: number;
  /** 该站稿应包含的可抽取块，缺了只警告。 */
  extractBlocks: ExtractBlock[];
  /**
   * 是否默认参与本次任务。
   * 填表尚未打通的站默认 false，避免一确认就失败。
   */
  defaultSelected: boolean;
}

export type PlatformRuleMap = Record<PlatformId, PlatformRule>;
