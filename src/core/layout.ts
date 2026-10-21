export interface LayoutIssue {
  code: 'overflow' | 'blank-page' | 'orphan-heading' | 'missing-content' | 'too-small-font';
  message: string;
  page?: number;
}
export interface LayoutReport {
  id: string;
  revision: number;
  rendererVersion: string;
  pageCount: number;
  layoutValid: boolean;
  issues: LayoutIssue[];
  constraints?: { maxPages: number; satisfied: boolean };
  /** Share of each page's usable height that content occupies, 0–1. */
  pageFill?: number[];
}
