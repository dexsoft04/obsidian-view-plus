# View Plus

Obsidian 插件，将文件浏览器的可见范围扩展至默认被忽略的内容：点文件与点文件夹、Obsidian 不支持的文件扩展名，以及经符号链接挂载到 vault 的外部路径。内置语法高亮代码查看器、CSV/TSV 表格渲染和媒体预览，支持将任意文件交由系统默认应用打开。

> **仅限桌面端。** 隐藏文件功能依赖桌面内部 API，在移动端会自动禁用。

## 功能一览

| 功能 | 说明 |
|---|---|
| **显示隐藏文件** | 在文件浏览器中显示点文件和点文件夹（`.env`、`.gitignore`、`.github/` 等） |
| **显示不支持的文件类型** | 显示 Obsidian 原生不支持的扩展名（`.py`、`.js`、`.json`、`.csv` 等） |
| **内置代码查看器** | 以语法高亮只读视图打开源代码和配置文件，超过 500 KB 时显示提示而非渲染 |
| **CSV / TSV 表格视图** | 将 `.csv` / `.tsv` 渲染为带粘性表头的可滚动表格，最多显示 5,000 行 |
| **媒体查看器** | 内嵌预览 Obsidian 原生不支持的图片、音频、视频格式 |
| **用系统应用打开** | 双击、右键菜单、视图工具栏按钮、命令面板均可调起系统默认应用 |
| **排除规则** | 用 Glob 模式屏蔽特定路径，支持 `*`、`**` 和 `!` 取反 |
| **符号链接支持** | 跟随符号链接并将其内容注册到 vault，循环链接通过深度限制自动跳过 |

## 安装

### 社区插件市场（推荐）

1. 打开 **设置 → 第三方插件 → 浏览**
2. 搜索 **View Plus**
3. 点击 **安装**，再点击 **启用**

### 手动安装

1. 从 [最新 Release](../../releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/obsidian-view-plus/`
3. 重启 Obsidian，在 **设置 → 第三方插件** 中启用

## 设置

### 显示隐藏文件和文件夹

通过补丁 vault 内部文件系统适配器，将点文件和点文件夹注册到 Obsidian 的文件索引。

- 完全生效需要重启 Obsidian
- 大型点文件夹（如 `.git`）在首次扫描时可能短暂卡顿，建议用**排除规则**屏蔽
- 关闭后已显示的文件需重启 Obsidian 才会从文件浏览器中消失

### 显示不支持的文件类型

启用 Obsidian 内置的 `showUnsupportedFiles` vault 配置，使非 Markdown 文件出现在文件浏览器中。禁用插件时自动还原为原始状态。

### 排除规则

每行一个 Glob 模式，匹配的路径将被隐藏。语法为 `.gitignore` 的子集，规则从上到下评估，**最后一条匹配规则生效**。

| 模式 | 匹配范围 |
|---|---|
| `.git/**` | `.git` 及其所有内容 |
| `*.log` | 任意深度的所有 `.log` 文件 |
| `.env*` | `.env`、`.env.local`、`.env.production` 等 |
| `src/*.ts` | `src/` 直接子级的 `.ts` 文件（不递归） |
| `**/vendor` | 任意深度名为 `vendor` 的目录 |
| `!.git/config` | **取反** — 覆盖前面对该路径的排除 |

- 不含 `/` 的模式：匹配任意深度的文件或目录名
- 含 `/` 的模式：锚定到 vault 根目录
- `*` 匹配单个路径段内的任意字符；`**` 跨路径段匹配

**默认规则：**

```
.git/**
!.git/config
```

隐藏整个 `.git` 目录，但保留 `config` 文件可查看。

## 用系统应用打开

对任意非 Markdown 文件，有四种方式调起系统默认应用：

- **双击**文件浏览器中的文件名
- **右键** → "Open with system app"
- 在文件查看器视图右上角点击**外部链接按钮**
- **命令面板** → "View Plus: Open with system app"（可绑定快捷键）

## CSV / TSV 表格视图

`.csv` 和 `.tsv` 文件自动渲染为带粘性表头的可滚动表格。超过 5,000 行时截断并显示剩余行数提示。支持带引号字段和 `""` 转义的标准 RFC 4180 格式，并自动去除 Excel 导出时的 UTF-8 BOM。

## 媒体查看器

以下格式在 Obsidian 内嵌预览（不覆盖 Obsidian 原生支持的格式）：

| 类型 | 格式 |
|---|---|
| 图片 | `avif` `ico` `tiff` `tif` |
| 音频 | `aac` `opus` |
| 视频 | `mov` `avi` `mkv` `wmv` `m4v` |

浏览器无法解码时会显示提示并引导使用外部应用打开。

## 内置代码查看器

以只读语法高亮视图打开文本和代码文件，超过 **500 KB** 时显示大小提示而非渲染内容。

<details>
<summary>支持的扩展名</summary>

| 分类 | 扩展名 |
|---|---|
| Web / 脚本 | `js` `mjs` `cjs` `ts` `jsx` `tsx` `py` `rb` `php` `go` `rs` |
| 系统语言 | `c` `h` `cpp` `hpp` `java` `kt` `swift` |
| 配置 / 数据 | `json` `yaml` `yml` `toml` `ini` `cfg` `conf` `properties` `env` |
| Git / 编辑器 | `gitignore` `gitconfig` `gitattributes` `editorconfig` |
| 容器 / 锁文件 | `dockerignore` `lock` |
| 样式 / 标记 | `css` `scss` `sass` `less` `html` `htm` `xml` |
| Shell | `sh` `bash` `zsh` `fish` `ps1` |
| 查询 / 数据 | `sql` `csv` `tsv` |
| 其他文本 | `txt` `log` `diff` `patch` |

</details>

## 符号链接

View Plus 会跟随 vault 内的符号链接（Windows junction、NTFS symlink 或 WSL 挂载路径），将其目标内容注册到 vault，使其出现在文件浏览器中。循环链接通过递归深度限制（最大 25 层）自动检测并跳过。

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 监听模式（增量构建）
npm run build        # 生产构建
npm run deploy       # 构建并部署到本地 vault
```

TypeScript 源码位于 `src/`：

| 文件 | 职责 |
|---|---|
| `src/main.ts` | 插件入口、隐藏文件补丁、文件发现与排除逻辑 |
| `src/viewer.ts` | 代码查看器、CSV 表格渲染、媒体查看器 |
| `src/settings.ts` | 设置面板 UI |

## License

MIT
