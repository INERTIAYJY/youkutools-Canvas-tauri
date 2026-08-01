# AI Canvas 官网

`site/` 是 AI Canvas 的产品官网，纯静态页面，不参与主应用构建，也不引入任何构建步骤或外部 CDN 资源。

```text
site/
├── index.html      # 全部页面结构
├── styles.css      # 全部样式（深色单主题）
├── script.js       # 滚动进场、平台识别、导航交互
├── .nojekyll       # 跳过 GitHub Pages 的 Jekyll 处理
└── assets/
    ├── icon.svg        # 复制自 public/icons.svg
    ├── favicon.svg     # 复制自 public/favicon.svg
    └── screenshot.jpg  # 复制自 public/screenshot.jpg
```

## 本地预览

任意静态服务器即可，例如：

```bash
python3 -m http.server 4321 --directory site
```

然后访问 <http://localhost:4321>。

## 部署

`.github/workflows/pages.yml` 会在 `site/**` 变更推送到 `master` 时自动部署到 GitHub Pages，也可以在 Actions 页面手动触发。

首次部署前需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 维护约定

- 页面文案以 `README.md` 与 `.release-notes.md` 的既有描述为准，不要写入未实现的能力。
- 版本号出现在 hero 徽章与下载区，发版时同步更新。
- 应用截图更新后，重新从 `public/screenshot.jpg` 复制到 `site/assets/`。
- 保持零外部依赖：不要引入 CDN 字体、脚本或分析代码。
