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

1. TTS 提供商选择“Windows 本机语音（可接 RVC）”。
2. 勾选“启用 RVC 音色转换”。
3. RVC 地址填 Tailscale Serve 的 HTTPS 地址并以 `/convert` 结尾。
4. 把本机 `D:\\RVC\\rvc_api_key.txt` 的内容填入 RVC API 密钥框。不要把密钥发到聊天里。
5. 测试文本用英文；本机当前安装的英文系统语音是 Microsoft Zira Desktop。

SillyTavern 页面运行在 HTTPS 时，RVC 地址也必须是 HTTPS。推荐用 Tailscale Serve，只在同一 Tailnet 内提供 HTTPS；不要使用公网 Funnel，也不要把 8765 端口公开到互联网。
