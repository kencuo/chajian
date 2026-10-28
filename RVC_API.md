# Connor RVC 与 Windows 本机语音

扩展提供三种语音路线：

- 浏览器系统语音：仅由当前浏览器朗读，不能送入 RVC。
- MiniMax / OpenAI 兼容 TTS：在线合成音频，再交给 RVC。
- Windows 本机语音：调用此 Windows 电脑的 `/synthesize` 端点，使用系统安装的英文语音生成 WAV，再交给 Connor RVC；不需要外部 TTS 账号。

## 本机 API

- `GET /health`：健康检查。
- `POST /synthesize`：JSON `{"text":"Hello, Connor."}`，返回 WAV。
- `POST /convert`：multipart 字段 `audio`、`voice`、`pitch`、`index_rate`，返回转换后的 WAV。

所有 POST 请求使用 `Authorization: Bearer <API key>`。Windows 本机语音路线会用同一 API 地址和密钥，把 `/convert` 自动映射为 `/synthesize`。

## 酒馆配置

### 逐段对白朗读

默认开启“在每段对白旁显示语音按钮”。消息中每对英文双引号、中文双引号或「」『』结束处会出现小喇叭；点击只合成并播放这一段对白，再次点击复用缓存，长按重新生成。生成时按钮显示等待状态且禁止重复提交。代码块和链接内不会插入按钮。手机使用独立于图标字体的喇叭标记，并提供较大的触摸区域。

此开关独立于“隐藏消息气泡中的 TTS 图标”，可只保留对白旁的小喇叭。文本编辑或切换消息后自动更新，不修改聊天存储的原文。单段对白仍受本机 API 的 20000 字符及 40 MiB 音频限制。

### 本机语音设置

1. TTS 提供商选择“Windows 本机语音（可接 RVC）”。
2. 勾选“启用 RVC 音色转换”。
3. RVC 地址填 Tailscale Serve 的 HTTPS 地址并以 `/convert` 结尾。
4. 把本机 `D:\\RVC\\rvc_api_key.txt` 的内容填入 RVC API 密钥框。不要把密钥发到聊天里。
5. 测试文本用英文；本机当前安装的英文系统语音是 Microsoft Zira Desktop。

SillyTavern 页面使用 HTTPS 时，远程直连接口也应使用 HTTPS，避免浏览器混合内容限制。可使用 Tailscale Serve，只在同一 Tailnet 内提供 HTTPS；不要把 8765 端口直接公开到互联网。

### 云端同源中转（1.5.3）

云端酒馆可以另行安装 `connor-rvc` 服务端中转插件。服务端插件、配置与密钥不属于此前端扩展，更新此前端不会自动安装或更新中转。

服务端中转已部署且包含 `/speak` 合并接口时，设置如下：

1. 提供商选择 Windows 本机语音，保留启用 RVC 转换。
2. RVC API 地址填写 `/api/plugins/connor-rvc/convert`，或当前酒馆同源的完整地址。
3. 清空前端的 RVC 密钥框；密钥只保存在中转服务端配置中。

此前端会自动改为调用 `/api/plugins/connor-rvc/speak`，由服务端连续完成 TTS 合成及 RVC 转换，再以 JSON/Base64 返回最终 WAV。手机不再下载普通 TTS 音频后重新上传，合并结果不会重复执行 RVC。

同源请求带上酒馆 CSRF 请求头。中转必须使用同一协议、域名和端口；仅路径一致但来源不同不会启用此路线。前端合并请求最多等待 180 秒，建议以短对白进行测试。

改回远程直连接口时，仍按本机语音设置填写 HTTPS `/convert` 地址与 RVC 密钥；原有直接合成、转换路线保留。

### 手机播放权限

浏览器可能拒绝在等待生成后自动播放音频。1.5.3 遇到 `NotAllowedError` 时不会丢弃生成结果，而是显示屏幕下方的“点此播放语音”按钮和原生音频控件。用户再次点击时直接播放已取得的音频，不重新请求 TTS 或 RVC。

停止或播放结束时清理临时播放地址。缓存仍属于当前浏览器和站点，不会在电脑、手机之间自动同步。

本版的前端、中转兼容性和播放回退逻辑已有本地测试；不同手机浏览器的实际表现仍需设备验证。更新后请重新加载酒馆页面。
