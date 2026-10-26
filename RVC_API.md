RVC 接口约定
酒馆扩展会先调用远程 TTS，随后向配置的 RVC API 地址发送 POST 请求。
请求格式为 multipart/form-data：
audio：TTS 返回的音频文件
voice：模型或音色名，默认 ConnorDetroit_365e_10220s
pitch：变调半音数
index_rate：Index 比例，范围 0 到 1
接口应直接返回转换后的音频二进制，并设置 Content-Type 为 audio/wav、audio/mpeg 或 application/octet-stream。如果设置了密钥，扩展会发送 Authorization: Bearer 密钥。
由于酒馆页面运行在浏览器中，服务还需要允许跨域 POST 和预检 OPTIONS 请求。酒馆使用 HTTPS 时，RVC 地址也必须使用 HTTPS；本机服务不要直接暴露到公网，建议通过带身份验证的安全隧道访问。
这个文件只定义酒馆端的通信格式，不包含 RVC 推理后端本身。
