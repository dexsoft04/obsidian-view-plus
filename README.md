# View Plus

[Obsidian](https://obsidian.md) 插件，将 Obsidian 默认隐藏的文件暴露出来：点文件、点文件夹、非 Markdown 文件类型以及符号链接目录。

## 功能

| 功能 | 说明 |
|---|---|
| **显示隐藏文件** | 在文件浏览器中显示点文件和点文件夹（`.env`、`.gitignore`、`.github/` 等） |
| **显示不支持的文件类型** | 显示 Obsidian 原生不支持的扩展名文件（`.py`、`.js`、`.json`、`.csv` 等） |
| **内置代码查看器** | 以语法高亮的只读视图打开源代码和配置文件 |
| **CSV / TSV 表格视图** | 将 `.csv` 和 `.tsv` 文件渲染为可滚动的交互式表格，支持粘性表头 |
| **媒体查看器** | 内嵌预览 Obsidian 原生不支持的图片（avif、ico、tiff）、音频（aac、opus）和视频（mov、mkv、avi 等）格式 |
| **用系统应用打开** | 右键菜单、双击文件浏览器、视图内操作按钮和命令面板均可将文件交给系统默认应用打开 |
| **排除规则** | 用 Glob 模式屏蔽特定路径，支持 `*`、`**` 和 `!` 取反 |
| **符号链接支持** | 跟随符号链接并注册其内容，使其出现在文件浏览器中 |

> **仅限桌面端。** 隐藏文件功能依赖 Obsidian 桌面端内部 API，在移动端会自动禁用。

## 安装

### 通过社区插件市场（推荐）

1. 打开 **设置 → 第三方插件 → 浏览**
2. 搜索 **View Plus**
3. 点击 **安装**，再点击 **启用**

### 手动安装

1. 从 [最新 Release](../../releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`
2. 复制到 `<vault>/.obsidian/plugins/obsidian-view-plus/`
3. 重启 Obsidian，在 **设置 → 第三方插件** 中启用

## 设置说明

### 显示隐藏文件和文件夹

通过修补 vault 内部文件系统适配器，在文件浏览器中显示点文件和点文件夹。

- 完全生效需要重启 Obsidian
- 大型点文件夹（如 `.git`）在首次扫描时可能短暂卡顿，不需要时建议加入**排除规则**
- 关闭此开关后已显示的文件需重启 Obsidian 才能从文件浏览器中消失

### 显示不支持的文件类型

启用 Obsidian 内置的 `showUnsupportedFiles` vault 配置，使非 Markdown 扩展名的文件出现在文件浏览器中。禁用插件时会将该配置恢复为原始状态。

### 排除规则

每行一个 Glob 模式，匹配的路径将从文件浏览器中隐藏。语法为 `.gitignore` 的子集：

| 模式 | 匹配范围 |
|---|---|
| `.git/**` | `.git` 文件夹及其所有内容 |
| `*.log` | 任意深度的所有 `.log` 文件 |
| `.env*` | `.env`、`.env.local`、`.env.production` 等 |
| `src/*.ts` | `src/` 直接子级的 `.ts` 文件（不含更深层） |
| `**/vendor` | 任意深度名为 `vendor` 的文件夹 |
| `!.git/config` | **取反** — 覆盖前面对该路径的排除规则 |

**规则说明：**

- **不含 `/` 的模式**：匹配 vault 中任意深度的文件或文件夹名
- **含 `/` 的模式**：锚定到 vault 根目录
- `*`：匹配单个路径段内的任意字符（不跨越 `/`）
- `**`：匹配跨路径段的任意字符（包含 `/`）
- 规则从上到下依次评估，**最后一条匹配的规则生效**
- 以 `!` 开头的行表示取反，取消前面已匹配的排除

**默认规则：**

```
.git/**
!.git/config
```

隐藏整个 `.git` 文件夹，但保留 `config` 文件可查看，避免暴露大量对象文件。

## 用系统应用打开

对任意非 Markdown 文件，有三种方式调起系统默认应用：

- **双击**文件浏览器中的文件名
- **右键** → "Open with system app"
- 在文件查看器视图右上角点击 **外部链接按钮**
- **命令面板** → "View Plus: Open with system app"（可绑定快捷键）

## CSV / TSV 表格视图

`.csv` 和 `.tsv` 文件自动渲染为带粘性表头的可滚动表格，超过 5 000 行时截断并显示剩余行数提示。

## 媒体查看器

以下格式在 Obsidian 内嵌预览（不覆盖 Obsidian 原生支持的格式）：

| 类型 | 格式 |
|---|---|
| 图片 | `avif` `ico` `tiff` `tif` |
| 音频 | `aac` `opus` |
| 视频 | `mov` `avi` `mkv` `wmv` `m4v` |

如果浏览器无法解码该格式，会显示提示并引导使用外部应用打开。

## 内置代码查看器

识别的文本扩展名文件会在只读的语法高亮视图中打开，而非触发下载。

<details>
<summary>支持的扩展名</summary>

| 分类 | 扩展名 |
|---|---|
| Web / 脚本 | `js` `mjs` `cjs` `ts` `jsx` `tsx` `py` `rb` `php` `go` `rs` |
| 系统语言 | `c` `h` `cpp` `hpp` `java` `kt` `swift` |
| 配置 / 数据 | `json` `yaml` `yml` `toml` `ini` `cfg` `conf` `properties` `env` |
| Git / 编辑器配置 | `gitignore` `gitconfig` `gitattributes` `editorconfig` |
| 容器 / 锁文件 | `dockerignore` `lock` |
| 样式 / 标记 | `css` `scss` `sass` `less` `html` `htm` `xml` |
| Shell | `sh` `bash` `zsh` `fish` `ps1` |
| 查询 / 数据 | `sql` `csv` `tsv` |
| 其他文本 | `txt` `log` `diff` `patch` |

超过 **500 KB** 的文件将显示大小提示而非渲染内容。

</details>

## 符号链接

如果 vault 内存在符号链接（Windows junction、NTFS symlink，或形如 `mnt/c/…` 的 WSL 挂载路径），View Plus 会跟随符号链接并将其内容注册到 vault，使其出现在文件浏览器中。这样即可通过放置在 vault 内的符号链接浏览 vault 根目录以外的文件。

循环符号链接通过递归深度限制自动检测并跳过。

## 开发

```bash
# 安装依赖
npm install

# 监听模式（增量构建）
npm run dev

# 生产构建
npm run build

# 构建并部署到本地 vault
npm run deploy
```

TypeScript 源码位于 `src/`：

| 文件 | 职责 |
|---|---|
| `src/main.ts` | 插件入口、隐藏文件补丁、文件发现逻辑 |
| `src/viewer.ts` | 代码查看器（`TextFileView` 子类） |
| `src/settings.ts` | 设置面板 UI |

## License

MIT
