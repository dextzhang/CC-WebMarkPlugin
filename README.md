# CC Mark

一个个人自用的 Chrome 网页标记收藏插件。它会读取当前网页信息，保存你写下的备注和标签，并把本地收藏同步到 GitHub 仓库中的 `bookmarks.json` 和 `bookmarks.md`。

## 初版功能

- 读取当前网页标题、URL、canonical URL、描述、站点名、作者/UP 主信息。
- 清理常见跟踪参数，例如 `utm_*`、`vd_source`、`spm_id_from`。
- 收藏时保存原始 URL、精简 URL、标题、作者、备注、标签、收藏时间。
- 本地保留完整收藏列表，插件面板显示最近 10 条。
- 抖音网页适配：在 `douyin.com` 点击分享里的复制链接后，插件会优先识别最近复制的抖音分享链接作为收藏对象。
- 最近收藏按这种紧凑格式展示：

```text
https://www.bilibili.com/video/BV1svLm6UE1r - '网页标题' UP主名字
  #标签 自己写的备注内容
  2026-05-21
```

- GitHub 同步同时维护两份文件：
  - `bookmarks.json`：结构化备份，方便后续搜索、迁移、合并。
  - `bookmarks.md`：人类可读文档，按时间倒序排列。
- 同步策略是读取远端、合并本地、按收藏时间倒序写回。
- 不按网页 URL 去重，同一个网页可以因为不同备注被收藏多次。
- 每条收藏有独立 `id`，只用于避免同一条记录被重复上传。
- Token 只保存在本地浏览器的扩展存储中。

## Chrome 安装方式

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 打开任意网页后点击插件图标使用。

## GitHub 配置

在插件面板的 GitHub 同步区填写：

- 仓库：`owner/repo`
- 分支：通常是 `main`
- Token：建议使用只具备目标仓库 Contents 读写权限的 fine-grained token
- JSON 路径：默认 `bookmarks.json`
- MD 路径：默认 `bookmarks.md`

开启“自动上传”后，每次添加收藏都会尝试同步到 GitHub。网络不可用或 Token 权限不足时，本地收藏仍会保存，之后可以手动点“上传”。

## 数据格式

`bookmarks.json` 示例：

```json
[
  {
    "id": "1779357600000-uuid",
    "title": "网页标题",
    "url": "https://www.bilibili.com/video/BV1svLm6UE1r/?vd_source=...",
    "cleanUrl": "https://www.bilibili.com/video/BV1svLm6UE1r",
    "author": "UP主名字",
    "siteName": "哔哩哔哩",
    "hostname": "www.bilibili.com",
    "description": "页面描述",
    "note": "自己写的备注内容",
    "tags": ["标签"],
    "createdAt": "2026-05-21T10:00:00.000Z",
    "updatedAt": "2026-05-21T10:00:00.000Z"
  }
]
```

`bookmarks.md` 示例：

```md
# Bookmarks

## 2026-05-21 18:00

- 标题：[网页标题 UP主名字](https://www.bilibili.com/video/BV1svLm6UE1r)
- 标签：#标签
- 备注：自己写的备注内容
```

## 后续可扩展

- 全部收藏管理页。
- 搜索标题、备注、标签、域名。
- 编辑/删除收藏并同步。
- GitHub 连接测试按钮。
- 自动识别更多网站的作者字段。
- 增加更多站点适配器，例如 Twitter/X、Pixiv、YouTube。
- 给 Markdown 增加按标签或月份的索引。
