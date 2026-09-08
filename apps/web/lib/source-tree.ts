// Source 源码 tab 的纯函数(R-SOURCE,画板 2n / 2o):路径列表 → 目录树、当前文件所在的目录集合、体积文案。
//
// **必须是纯的**:同时被 Server Component(page.tsx)与 Client Component(SourceBrowser)import,
// 不能碰 `@/lib/api`。有 `bun test lib` 的投影测试(source-tree.test.ts)。

export interface SourceFileMeta {
  path: string;
  kind: string;
  bytes: number;
  lines: number;
}

export interface SourceTreeNode {
  name: string;
  /** 目录的完整路径(不带尾斜杠);文件为 undefined */
  dir?: string;
  /** 文件的完整路径;目录为 undefined */
  path?: string;
  bytes?: number;
  children: SourceTreeNode[];
}

/**
 * 路径列表 → 树。每一层**先目录后文件**、各自按名字的码点序(画板 2n:`apps/` 下先 `api/` `web/`,
 * `web/` 下先 `app/` `components/` 再 `next.config.mjs`)。与 Skills 那棵(先文件后目录)刻意不同 —— 这里目录会折叠,
 * 目录在前才让「收起的目录」聚在一起。
 */
export function buildSourceTree(files: readonly SourceFileMeta[]): SourceTreeNode[] {
  const root: SourceTreeNode = { name: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      let dir = node.children.find((c) => c.dir !== undefined && c.name === parts[i]);
      if (!dir) node.children.push((dir = { name: parts[i], dir: prefix, children: [] }));
      node = dir;
    }
    node.children.push({ name: parts[parts.length - 1], path: f.path, bytes: f.bytes, children: [] });
  }
  const sortLevel = (nodes: SourceTreeNode[]) => {
    nodes.sort((a, b) => {
      const ad = a.dir !== undefined;
      const bd = b.dir !== undefined;
      if (ad !== bd) return ad ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    for (const n of nodes) if (n.dir !== undefined) sortLevel(n.children);
  };
  sortLevel(root.children);
  return root.children;
}

/**
 * 一个文件路径经过的全部目录(`apps/api/agent/tools.ts` → `apps`、`apps/api`、`apps/api/agent`)。
 * 画板 2n / 2o 的折叠规则:默认只展开当前文件所在的那条路径;根目录下的文件(README.md)一个目录都不展开。
 */
export function dirsOf(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  let prefix = "";
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    out.push(prefix);
  }
  return out;
}

/** 体积文案:画板写作 `4.1 KB` / `81.4 KB`,整仓 `3.1 MB` */
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 行数文案:画板 `1,930 行`(千分位) */
export function fmtLines(lines: number): string {
  return `${lines.toLocaleString("en-US")} 行`;
}
