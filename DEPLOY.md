# 发布

`release-files.json` 分别列出源码仓库和静态网站需要的文件。发布命令只复制清单中的文件。
应用在浏览器中运行，不需要外部运行时依赖；Node.js 工具用于开发、检查和准备发布目录。

## 准备源码目录

安装开发依赖并运行检查：

```bash
npm ci
npm run format:check
npm run lint
npm run check:release
```

导出到一个尚不存在的目录：

```bash
npm run release:source -- ../bel-canto-release
```

源码目录包含应用、开发工具、测试生成脚本及其合成输入、包与检查配置、README、本文和 LICENSE。
它不包含 `.git`、`node_modules`、生成的站点或测试输出。
以 `release-files.json` 的 `source` 清单为准。
将这个导出目录作为公开仓库的文件内容。

运行浏览器测试所需的 `tools/test-vocal.wav` 可由 `node tools/make-test-wav.mjs` 重新生成，测试步骤见 [README.md](README.md)。

## 准备静态网站

从当前源码生成站点目录：

```bash
npm run build
```

`dist/` 包含 `index.html`、`styles.css`、`src/` 中的运行模块、`.nojekyll` 和 `LICENSE`，
以 `release-files.json` 的 `site` 清单为准。它不包含开发工具或仓库文档。
应用资源和 worklet 使用相对地址，可部署到站点根目录或项目子路径。

本地预览生成的站点：

```bash
python3 -m http.server 5201 --directory dist
```

打开 <http://127.0.0.1:5201>。预览使用静态服务，不提供音频格式转换。

## 托管

GitHub Pages、Netlify 等静态托管服务应使用 `dist/` 的内容作为站点文件。
使用 Netlify Drop 时上传 `dist/` 文件夹。不要把源码仓库根目录作为站点上传目录。

公开站点应使用 HTTPS，以便浏览器请求麦克风权限。
部署后检查实际站点路径下的页面、模块和 worklet 是否可加载，再验证麦克风、文件播放和 WAV 导出。
格式和文件清单检查不能代替浏览器行为测试。

## 格式转换边界

浏览器直接支持的音频格式可以在静态站点载入和导出。
浏览器解码失败时，ALAC、AIFF 和 CAF 的转换需要本地 `npm start` 提供的 `/api/convert`，
该服务调用 macOS 的 `afconvert`。静态托管没有这一服务，请先将此类文件转成 WAV。

格式转换 API 使用根路径 `/api/convert`；它与应用静态资源的相对路径加载方式不同。
文件导出仍由浏览器完成，包含源文件全长和 3 秒混响尾音。
