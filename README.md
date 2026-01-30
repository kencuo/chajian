# 智能媒体助手（同层手机识图插件）

SillyTavern 扩展：统一处理图片与文本类文档（压缩/落盘/发送到聊天），并暴露一组全局 API 供其它脚本调用。

## 功能

- 图片处理
  - 支持常见图片格式（jpg/jpeg/png/gif/webp/bmp）
  - 可选压缩：将图片缩放到最大边长并转为 JPEG
  - 通过 SillyTavern 内置 `saveBase64AsFile` 保存到用户图片目录的子目录（默认 `phone/`）
- 文档处理
  - 支持 txt/json/md/csv/html/xml/js/css/rtf 等文本类文件
  - 读取为 UTF-8 文本；对 json 做格式化、对 csv 做行数预览截断
  - 可选“AI 文档阅读”：将内容作为用户消息发送到聊天
- 设置面板
  - 在扩展设置页添加一个可折叠面板，配置开关/图片质量/最大尺寸/文件大小等

## 安装

1. 将本扩展文件放入 SillyTavern 的扩展目录（与其它扩展一致的目录层级）。
2. 进入 SillyTavern → Extensions（扩展）设置页，启用/刷新扩展。
3. 在扩展设置页中找到 “识图插件 byctrl” 面板进行配置。

> 注意：本扩展使用了 SillyTavern 前端的内部模块相对路径 import（如 `../../../../script.js`、`../../../utils.js`）。
> 如果你把文件放到与预期不同的目录层级，可能会导致 import 失败；请确保它位于标准扩展目录结构下。

## 使用方式

### 1) 作为全局 API 被其它脚本调用

扩展加载后会在 `window` 上暴露以下函数：

- `window.__processFileByPlugin(file, options?)`
  - 自动识别并处理图片/文档
- `window.__uploadImageByPlugin(file, options?)`
  - 处理单张图片
- `window.__uploadMultipleImagesByPlugin(files, options?)`
  - 批量处理多张图片，返回 `results` 与 `errors`
- `window.__processDocumentByPlugin(file, options?)`
  - 处理文档；默认会发到聊天（可用 `options.sendToChat=false` 关闭）
- `window.__isDocumentFile(file)`
  - 判断是否为支持的文档类型
- `window.__getSupportedFileTypes()`
  - 获取支持的 MIME 与扩展名列表

`options`（图片/文档处理时）：

- `sendToChat`（仅文档）: `false` 可禁止自动发送到聊天

### 2) 文档内容桥接（Slash 命令方式）

扩展还会暴露：

- `window.smartMediaAssistant.processText(text, options?)`

它会尝试通过 `executeSlashCommandsWithOptions` 或 `triggerSlash` 发送：

- `/send <内容> | /trigger`

用于触发后续的生成/总结流程。

## 输出说明

### 图片处理返回值

图片处理成功时返回：

- `success: true`
- `url`: `saveBase64AsFile` 返回的可访问 URL
- `metadata`: 原始/处理后文件名、大小、时间等

默认保存路径（概念上）：

- `.../user/images/phone/<uniqueId>.jpg`

### 文档处理返回值

文档处理成功时返回：

- `success: true`
- `content`: 处理后的文本内容
- `metadata`: 文件名/类型/大小/长度/时间等

## 配置项

在扩展设置中可配置：

- 启用图片处理 / 启用文档处理
- 图片质量（10-100）
- 图片最大尺寸（512-4096）
- 文件大小限制（MB）
- 启用 AI 文档阅读（发送到聊天）
- 显示处理信息（toastr 提示）
- 调试日志（console）

## 已知限制/注意事项

- 图片会统一转为 JPEG：透明背景（PNG/WebP）会丢失透明信息。
- 文档发送到聊天优先使用 `addOneMessage`（window/parent/top）；如果不可用，会尝试走 slash `/send ... | /trigger`（依赖 `slash-commands.js` 或 `triggerSlash`）。
- 该扩展依赖 SillyTavern 前端内部模块（`getContext` / `saveBase64AsFile` 等）；若目录层级不匹配导致 import 失败，会直接报错并无法工作。

## 开发/排错

- 打开“调试日志”后，在浏览器 DevTools Console 查看 `[Smart Media Assistant]` 前缀日志。
- 如遇 import 报错，优先检查扩展所在目录层级是否与相对路径匹配。
