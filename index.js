/**
 * 智能媒体助手 - SillyTavern Extension
 * 统一的图片和文档处理插件
 * 作者: ctrl
 * 版本: 1.5
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { getStringHash, saveBase64AsFile } from '../../../utils.js';

// 插件配置
const PLUGIN_ID = 'smart-media-assistant';
const MODULE_NAME = 'smart-media-assistant';

// 默认配置
const DEFAULT_CONFIG = {
  enableImageProcessing: true,
  enableDocumentProcessing: true,
  imageQuality: 85,
  maxImageDimension: 2048,
  maxFileSize: 20,
  enableAIReading: true,
  showProcessingInfo: false,
  enableLogging: false,
  enableTTS: true,
  ttsProvider: 'browser',
  ttsApiUrl: '',
  ttsApiKey: '',
  ttsModel: '',
  ttsVoiceId: '',
  ttsFormat: 'mp3',
  ttsSpeed: 1,
  ttsVolume: 1,
  ttsPitch: 0,
  ttsTestText: '你好，这是一段 TTS 试听内容。',

  // 内部配置
  supportedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
  supportedImageExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
  supportedDocumentTypes: [
    'text/plain',
    'application/json',
    'text/markdown',
    'text/csv',
    'text/html',
    'text/xml',
    'application/xml',
    'text/javascript',
    'application/javascript',
    'text/css',
    'application/rtf',
  ],
  supportedDocumentExtensions: [
    'txt',
    'json',
    'md',
    'csv',
    'html',
    'xml',
    'js',
    'css',
    'rtf',
    'log',
    'conf',
    'config',
    'ini',
    'yaml',
    'yml',
  ],
};

// 全局配置管理
let pluginConfig = { ...DEFAULT_CONFIG };
const ttsPlaybackState = {
  audioElement: null,
  currentObjectUrl: '',
  activeMode: '',
  isSpeaking: false,
};
const nativeTtsIntegrationState = {
  lastMessageId: null,
  chatObserver: null,
  renderTimer: null,
  domEventsBound: false,
  contextEventsBound: false,
  slashCommandRegistered: false,
  slashCommandObject: null,
};

function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function coerceNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPluginContextSafe() {
  try {
    return typeof getContext === 'function' ? getContext() : null;
  } catch (error) {
    return null;
  }
}

function getDefaultTtsApiUrl(provider) {
  if (provider === 'minimax') return 'https://api.minimax.io/v1/t2a_v2';
  return '';
}

function getDefaultTtsModel(provider) {
  if (provider === 'minimax') return 'speech-2.8-hd';
  return '';
}

/**
 * 初始化插件配置
 */
function initConfig() {
  const context = typeof getContext === 'function' ? getContext() : null;
  if (!context) {
    throw new Error('[Smart Media Assistant] getContext() 不可用：请确认在 SillyTavern 扩展环境中运行');
  }
  context.extensionSettings = context.extensionSettings || {};
  const extensionSettings = context.extensionSettings[MODULE_NAME] || {};

  // 合并默认配置和用户配置
  pluginConfig = { ...DEFAULT_CONFIG, ...extensionSettings };

  // 保存到全局设置
  context.extensionSettings[MODULE_NAME] = pluginConfig;

  if (pluginConfig.enableLogging) {
    console.log('[Smart Media Assistant] 配置初始化完成:', pluginConfig);
  }
}

/**
 * 文件类型检测器
 */
class FileTypeDetector {
  static detectFileType(file) {
    if (!file || !file.name) {
      return { type: 'unknown', isImage: false, isDocument: false };
    }

    const fileType = file.type || '';
    const fileName = file.name || '';
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

    // 检测图片
    const isImageByType = pluginConfig.supportedImageTypes.includes(fileType) || fileType.startsWith('image/');
    const isImageByExt = pluginConfig.supportedImageExtensions.includes(fileExtension);
    // 有些环境（尤其移动端/拖拽）可能拿不到 file.type，此时用扩展名兜底
    const isImage = isImageByType || isImageByExt;

    // 检测文档
    const isDocumentByType =
      pluginConfig.supportedDocumentTypes.includes(fileType) ||
      fileType.startsWith('text/') ||
      fileType.includes('json') ||
      fileType.includes('xml');
    const isDocumentByExt = pluginConfig.supportedDocumentExtensions.includes(fileExtension);
    const isDocument = isDocumentByType || isDocumentByExt;

    // 排除冲突：如果同时匹配，优先按扩展名判断
    let finalType = 'unknown';
    let finalIsImage = false;
    let finalIsDocument = false;

    if (isImage && !isDocument) {
      finalType = 'image';
      finalIsImage = true;
    } else if (isDocument && !isImage) {
      finalType = 'document';
      finalIsDocument = true;
    } else if (isImage && isDocument) {
      // 冲突解决：优先按扩展名
      if (pluginConfig.supportedImageExtensions.includes(fileExtension)) {
        finalType = 'image';
        finalIsImage = true;
      } else {
        finalType = 'document';
        finalIsDocument = true;
      }
    }

    const result = {
      type: finalType,
      isImage: finalIsImage,
      isDocument: finalIsDocument,
      fileType: fileType,
      fileName: fileName,
      fileExtension: fileExtension,
      fileSize: file.size,
    };

    if (pluginConfig.enableLogging) {
      console.log('[File Type Detector] 检测结果:', result);
    }

    return result;
  }
}

/**
 * 文件验证器
 */
class FileValidator {
  static validate(file, expectedType = null) {
    if (!file || typeof file !== 'object') {
      throw new Error('无效的文件对象');
    }

    const maxBytes = pluginConfig.maxFileSize * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`文件过大，限制: ${pluginConfig.maxFileSize}MB`);
    }

    const detection = FileTypeDetector.detectFileType(file);

    if (expectedType === 'image' && !detection.isImage) {
      throw new Error(`不支持的图片格式: ${detection.fileType || '未知'} (${file.name})`);
    }

    if (expectedType === 'document' && !detection.isDocument) {
      throw new Error(`不支持的文档格式: ${detection.fileType || '未知'} (${file.name})`);
    }

    if (!expectedType && detection.type === 'unknown') {
      throw new Error(`不支持的文件类型: ${detection.fileType || '未知'} (${file.name})`);
    }

    return detection;
  }
}

/**
 * 图片处理器
 */
class ImageProcessor {
  static async processImage(file, options = {}) {
    if (!pluginConfig.enableImageProcessing) {
      throw new Error('图片处理功能已禁用');
    }

    const validation = FileValidator.validate(file, 'image');

    if (pluginConfig.showProcessingInfo) {
      toastr.info('正在处理图片...', '图片上传');
    }

    try {
      // 创建图片元素
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法获取 Canvas 2D 上下文');
      }

      const objectUrl = URL.createObjectURL(file);

      return new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            // 计算新尺寸
            let { width, height } = img;
            const maxDim = pluginConfig.maxImageDimension;

            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = (height * maxDim) / width;
                width = maxDim;
              } else {
                width = (width * maxDim) / height;
                height = maxDim;
              }
            }

            // 设置画布尺寸
            canvas.width = width;
            canvas.height = height;

            // 绘制图片
            ctx.drawImage(img, 0, 0, width, height);

            // 转换为base64
            const quality = pluginConfig.imageQuality / 100;
            const imageData = canvas.toDataURL('image/jpeg', quality);
            if (!imageData || !imageData.includes(',')) {
              throw new Error('图片编码失败');
            }

            // 保存文件
            const base64Content = imageData.split(',')[1];
            const fileExtension = 'jpg';
            const uniqueId = `${Date.now()}_${getStringHash(file.name)}`;
            // subfolder under SillyTavern's user images dir: .../user/images/phone/<filename>
            const storagePath = 'phone';

            if (typeof saveBase64AsFile !== 'function') {
              throw new Error('saveBase64AsFile 不可用：请确认 SillyTavern 版本与扩展加载路径正确');
            }

            const savedUrl = await saveBase64AsFile(base64Content, storagePath, uniqueId, fileExtension);

            const result = {
              success: true,
              url: savedUrl,
              metadata: {
                originalName: file.name,
                processedName: `${uniqueId}.${fileExtension}`,
                originalSize: file.size,
                processedSize: Math.round(base64Content.length * 0.75),
                format: file.type,
                optimized: true,
                timestamp: new Date().toISOString(),
              },
            };

            if (pluginConfig.showProcessingInfo) {
              toastr.success('图片处理完成', '图片上传');
            }

            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            // 释放 blob URL，避免内存泄漏
            try {
              URL.revokeObjectURL(objectUrl);
            } catch (_) {}
          }
        };

        img.onerror = () => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (_) {}
          reject(new Error('图片加载失败'));
        };
        img.src = objectUrl;
      });
    } catch (error) {
      if (pluginConfig.showProcessingInfo) {
        toastr.error(`图片处理失败: ${error.message}`, '图片上传');
      }
      throw error;
    }
  }
}

/**
 * 文档处理器
 */
class DocumentProcessor {
  static async processDocument(file, options = {}) {
    if (!pluginConfig.enableDocumentProcessing) {
      throw new Error('文档处理功能已禁用');
    }

    const validation = FileValidator.validate(file, 'document');

    if (pluginConfig.showProcessingInfo) {
      toastr.info('正在处理文档...', '文档上传');
    }

    try {
      // 读取文档内容
      const content = await DocumentProcessor.readFileContent(file, validation);

      // 处理内容
      const processedContent = DocumentProcessor.processContent(content, validation.fileExtension);

      const result = {
        success: true,
        content: processedContent,
        metadata: {
          originalName: file.name,
          type: file.type || 'text/plain',
          size: file.size,
          documentType: validation.fileExtension,
          contentLength: processedContent.length,
          timestamp: new Date().toISOString(),
        },
      };

      // 如果启用AI阅读且需要发送到聊天
      if (pluginConfig.enableAIReading && options.sendToChat !== false) {
        await DocumentProcessor.sendToChat(processedContent, file.name, validation.fileExtension);
      }

      if (pluginConfig.showProcessingInfo) {
        toastr.success('文档处理完成', '文档上传');
      }

      return result;
    } catch (error) {
      if (pluginConfig.showProcessingInfo) {
        toastr.error(`文档处理失败: ${error.message}`, '文档上传');
      }
      throw error;
    }
  }

  static readFileContent(file, validation) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = function (e) {
        try {
          resolve(e.target.result);
        } catch (error) {
          reject(new Error(`文件读取失败: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  static processContent(content, fileExtension) {
    switch (fileExtension) {
      case 'json':
        try {
          const jsonObj = JSON.parse(content);
          return JSON.stringify(jsonObj, null, 2);
        } catch (error) {
          console.warn('[Document Processor] JSON格式化失败，返回原始内容');
          return content;
        }

      case 'csv':
        // CSV预览处理
        const lines = content.split('\n');
        const maxPreviewLines = 50;
        if (lines.length > maxPreviewLines) {
          const previewLines = lines.slice(0, maxPreviewLines);
          return previewLines.join('\n') + `\n\n... (文件共${lines.length}行，仅显示前${maxPreviewLines}行)`;
        }
        return content;

      default:
        return content;
    }
  }

  static async sendToChat(content, fileName, documentType) {
    try {
      // 获取SillyTavern的聊天函数
      const addOneMessage =
        typeof window.addOneMessage === 'function'
          ? window.addOneMessage
          : typeof parent.addOneMessage === 'function'
            ? parent.addOneMessage
            : typeof top.addOneMessage === 'function'
              ? top.addOneMessage
              : null;

      if (addOneMessage) {
        // 限制显示长度
        const maxLength = 2000;
        const displayContent =
          content.length > maxLength ? content.substring(0, maxLength) + '\n\n...(内容已截断)' : content;

        // 文档类型图标
        const typeIcons = {
          json: '📋',
          md: '📝',
          html: '🌐',
          xml: '📄',
          csv: '📊',
          js: '⚡',
          css: '🎨',
          yaml: '⚙️',
          yml: '⚙️',
          log: '📜',
        };

        const icon = typeIcons[documentType] || '📄';
        const messageContent = `${icon} **文档内容** (${fileName})\n\n\`\`\`${documentType}\n${displayContent}\n\`\`\``;

        await addOneMessage({
          name: 'User',
          is_user: true,
          is_system: false,
          send_date: new Date().toISOString(),
          mes: messageContent,
          extra: {
            type: 'document_upload',
            file_name: fileName,
            document_type: documentType,
            processed_by: 'smart_media_assistant',
          },
        });

        if (pluginConfig.enableLogging) {
          console.log('[Document Processor] 文档已发送到聊天');
        }
      } else {
        // 兜底：某些版本/嵌入方式下 addOneMessage 不在 window 上，尝试走 slash /send
        try {
          await processTextBridge(content, { name: fileName });
        } catch (_) {}
      }
    } catch (error) {
      console.error('[Document Processor] 发送文档失败:', error);
    }
  }
}

/**
 * 主要的文件处理接口
 */
class FileProcessor {
  static async processFile(file, options = {}) {
    try {
      if (!file) {
        throw new Error('请提供文件');
      }

      const detection = FileTypeDetector.detectFileType(file);

      if (pluginConfig.enableLogging) {
        console.log('[File Processor] 处理文件:', {
          name: file.name,
          type: file.type,
          size: file.size,
          detection: detection,
        });
      }

      // 根据检测结果选择处理器
      if (detection.isImage) {
        if (pluginConfig.enableLogging) {
          console.log('[File Processor] 使用图片处理器');
        }
        return await ImageProcessor.processImage(file, options);
      } else if (detection.isDocument) {
        if (pluginConfig.enableLogging) {
          console.log('[File Processor] 使用文档处理器');
        }
        return await DocumentProcessor.processDocument(file, options);
      } else {
        throw new Error(`不支持的文件类型: ${detection.fileType || '未知'} (${file.name})`);
      }
    } catch (error) {
      console.error('[File Processor] 处理失败:', error);
      throw error;
    }
  }
}

// ==================== 外部API接口 ====================

/**
 * 通用文件处理接口
 */
window.__processFileByPlugin = async function (file, options = {}) {
  return await FileProcessor.processFile(file, options);
};

/**
 * 图片处理接口（支持单图片和多图片）
 */
window.__uploadImageByPlugin = async function (file, options = {}) {
  return await ImageProcessor.processImage(file, options);
};

/**
 * 多图片批量处理接口
 */
window.__uploadMultipleImagesByPlugin = async function (files, options = {}) {
  console.log(`🖼️ 插件开始批量处理 ${files.length} 张图片`);

  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      console.log(`🖼️ 处理第 ${i + 1}/${files.length} 张图片: ${file.name}`);
      const result = await ImageProcessor.processImage(file, options);

      // 为多图片结果添加索引信息
      result.multiImageIndex = i + 1;
      result.multiImageTotal = files.length;
      result.originalFileName = file.name;

      results.push(result);
      console.log(`✅ 第 ${i + 1} 张图片处理完成`);
    } catch (error) {
      console.error(`❌ 第 ${i + 1} 张图片处理失败:`, error);
      errors.push({
        index: i + 1,
        fileName: file.name,
        error: error.message,
      });
    }
  }

  console.log(`🖼️ 批量处理完成: 成功 ${results.length} 张，失败 ${errors.length} 张`);

  return {
    success: results.length > 0,
    results: results,
    errors: errors,
    totalCount: files.length,
    successCount: results.length,
    errorCount: errors.length,
  };
};

/**
 * 文档处理接口
 */
window.__processDocumentByPlugin = async function (file, options = {}) {
  return await DocumentProcessor.processDocument(file, options);
};

/**
 * 文件类型检测接口
 */
window.__isDocumentFile = function (file) {
  const detection = FileTypeDetector.detectFileType(file);
  return detection.isDocument;
};

/**
 * 获取支持的文件类型
 */
window.__getSupportedFileTypes = function () {
  return {
    images: pluginConfig.supportedImageTypes,
    documents: pluginConfig.supportedDocumentTypes,
    imageExtensions: pluginConfig.supportedImageExtensions,
    documentExtensions: pluginConfig.supportedDocumentExtensions,
    all: function () {
      return [...this.images, ...this.documents];
    },
  };
};

// ==================== 插件生命周期 ====================

/**
 * 插件初始化
 */
function initPlugin() {
  console.log('[Smart Media Assistant] 插件初始化开始...');

  // 初始化配置
  initConfig();

  // 添加样式
  addPluginStyles();

  // 创建设置界面
  createSettingsInterface();

  // 绑定事件监听器
  bindEventListeners();
  syncTtsFormState();
  initNativeTtsIntegrations();

  // 绑定收缩栏功能
  bindCollapsibleEvents();

  console.log('[Smart Media Assistant] 插件初始化完成');

  // 显示加载成功提示
  if (pluginConfig.showProcessingInfo) {
    toastr.success('智能媒体助手已加载', '插件状态');
  }
}

/**
 * 创建设置界面
 */
function createSettingsInterface() {
  // 检查是否已存在设置界面
  if ($('#smart-media-assistant-settings').length > 0) {
    return;
  }

  // 创建设置HTML
  const settingsHTML = createSettingsHTML();

  // 添加到扩展设置页面
  const extensionsSettings = $('#extensions_settings');
  if (extensionsSettings.length > 0) {
    extensionsSettings.append(`<div id="smart-media-assistant-settings">${settingsHTML}</div>`);

    if (pluginConfig.enableLogging) {
      console.log('[Smart Media Assistant] 设置界面已创建');
    }
  } else {
    console.warn('[Smart Media Assistant] 无法找到扩展设置容器');
  }
}

/**
 * 添加插件样式
 */
function addPluginStyles() {
  // 适配 SillyTavern 统一外观：尽量复用内置样式，少量微调
  const styleId = 'smart-media-assistant-dynamic-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* 仅做轻微布局微调，避免“特立独行”的风格 */
    #smart-media-assistant-settings .settings-title-text { font-weight: 600; }
    #smart-media-assistant-settings .inline-drawer { margin-top: 6px; }
    #smart-media-assistant-settings .box-container { align-items: center; }
    #smart-media-assistant-settings .box-container .flex.flexFlowColumn { gap: 2px; }
    #smart-media-assistant-settings .range-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
    #smart-media-assistant-settings .range-row input[type="range"] { width: 100%; }
    #smart-media-assistant-settings .sma-stack { align-items: stretch; }
    #smart-media-assistant-settings .sma-field { width: 100%; box-sizing: border-box; }
    #smart-media-assistant-settings .sma-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    #smart-media-assistant-settings .sma-grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    #smart-media-assistant-settings .sma-label {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--SmartThemeBodyColor, var(--text-secondary, #888));
    }
    #smart-media-assistant-settings .sma-help {
      margin-top: 4px;
      font-size: 12px;
      color: var(--SmartThemeBodyColor, var(--text-secondary, #888));
      line-height: 1.5;
    }
    #smart-media-assistant-settings .sma-button-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    #smart-media-assistant-settings .sma-button-row .menu_button {
      min-width: 96px;
    }
    @media (max-width: 900px) {
      #smart-media-assistant-settings .sma-grid,
      #smart-media-assistant-settings .sma-grid-2 {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * 创建设置界面HTML
 */
function createSettingsHTML() {
  const ttsProvider = escapeHtmlAttr(pluginConfig.ttsProvider || 'browser');
  const ttsApiUrl = escapeHtmlAttr(pluginConfig.ttsApiUrl || '');
  const ttsApiKey = escapeHtmlAttr(pluginConfig.ttsApiKey || '');
  const ttsModel = escapeHtmlAttr(pluginConfig.ttsModel || '');
  const ttsVoiceId = escapeHtmlAttr(pluginConfig.ttsVoiceId || '');
  const ttsFormat = escapeHtmlAttr(pluginConfig.ttsFormat || 'mp3');
  const ttsSpeed = escapeHtmlAttr(String(coerceNumber(pluginConfig.ttsSpeed, 1)));
  const ttsVolume = escapeHtmlAttr(String(coerceNumber(pluginConfig.ttsVolume, 1)));
  const ttsPitch = escapeHtmlAttr(String(coerceNumber(pluginConfig.ttsPitch, 0)));
  const ttsTestText = escapeHtmlAttr(pluginConfig.ttsTestText || '你好，这是一段 TTS 试听内容。');

  // 复用 SillyTavern/JS‑Slash‑Runner 的外观结构
  return `
    <div id="smart-media-assistant" class="extension-root">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>识图插件 byctrl</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="extension-content flex flexFlowColumn gap10px">

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">启用图片处理</div>
                <div class="settings-title-description">开启图片压缩、优化和 AI 识图</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_enableImageProcessing" class="toggle-input" ${pluginConfig.enableImageProcessing ? 'checked' : ''} />
                <label for="${MODULE_NAME}_enableImageProcessing" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">启用文档处理</div>
                <div class="settings-title-description">支持 txt/json/md/csv 等文本</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_enableDocumentProcessing" class="toggle-input" ${pluginConfig.enableDocumentProcessing ? 'checked' : ''} />
                <label for="${MODULE_NAME}_enableDocumentProcessing" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">启用 AI 文档阅读</div>
                <div class="settings-title-description">上传后自动发送到对话并触发生成</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_enableAIReading" class="toggle-input" ${pluginConfig.enableAIReading ? 'checked' : ''} />
                <label for="${MODULE_NAME}_enableAIReading" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">图片质量 <span id="${MODULE_NAME}_imageQualityValue">${pluginConfig.imageQuality}</span>%</div>
                <div class="range-row">
                  <input type="range" id="${MODULE_NAME}_imageQuality" min="10" max="100" step="5" value="${pluginConfig.imageQuality}">
                </div>
                <div class="settings-title-description">数值越高质量越好但文件越大</div>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">图片最大尺寸 <span id="${MODULE_NAME}_maxImageDimensionValue">${pluginConfig.maxImageDimension}</span>px</div>
                <div class="range-row">
                  <input type="range" id="${MODULE_NAME}_maxImageDimension" min="512" max="4096" step="128" value="${pluginConfig.maxImageDimension}">
                </div>
                <div class="settings-title-description">图片的最大宽度或高度（像素）</div>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">文件大小限制 <span id="${MODULE_NAME}_maxFileSizeValue">${pluginConfig.maxFileSize}</span>MB</div>
                <div class="range-row">
                  <input type="range" id="${MODULE_NAME}_maxFileSize" min="1" max="100" step="1" value="${pluginConfig.maxFileSize}">
                </div>
                <div class="settings-title-description">允许处理的最大文件大小</div>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">显示处理信息</div>
                <div class="settings-title-description">显示文件处理进度与提示</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_showProcessingInfo" class="toggle-input" ${pluginConfig.showProcessingInfo ? 'checked' : ''} />
                <label for="${MODULE_NAME}_showProcessingInfo" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">调试日志</div>
                <div class="settings-title-description">在控制台输出更多信息</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_enableLogging" class="toggle-input" ${pluginConfig.enableLogging ? 'checked' : ''} />
                <label for="${MODULE_NAME}_enableLogging" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item box-container">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">启用 TTS 朗读</div>
                <div class="settings-title-description">给配套手机页面提供“朗读引用 / 朗读正文”的语音桥接</div>
              </div>
              <div class="toggle-switch">
                <input type="checkbox" id="${MODULE_NAME}_enableTTS" class="toggle-input" ${pluginConfig.enableTTS ? 'checked' : ''} />
                <label for="${MODULE_NAME}_enableTTS" class="toggle-label"><span class="toggle-handle"></span></label>
              </div>
            </div>

            <div class="extension-content-item sma-stack">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">TTS 提供商</div>
                <select id="${MODULE_NAME}_ttsProvider" class="text_pole sma-field">
                  <option value="browser" ${ttsProvider === 'browser' ? 'selected' : ''}>浏览器系统语音</option>
                  <option value="minimax" ${ttsProvider === 'minimax' ? 'selected' : ''}>MiniMax HTTP TTS</option>
                  <option value="openai-compatible" ${ttsProvider === 'openai-compatible' ? 'selected' : ''}>OpenAI 兼容 TTS</option>
                </select>
                <div class="sma-help" id="${MODULE_NAME}_ttsRemoteHint"></div>
              </div>
            </div>

            <div class="extension-content-item sma-stack">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">远程 TTS 配置</div>
                <div class="sma-grid-2">
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsApiUrl">接口地址</label>
                    <input type="text" id="${MODULE_NAME}_ttsApiUrl" class="text_pole sma-field" value="${ttsApiUrl}" placeholder="例如：https://api.minimax.io/v1/t2a_v2" />
                  </div>
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsApiKey">API Key</label>
                    <input type="password" id="${MODULE_NAME}_ttsApiKey" class="text_pole sma-field" value="${ttsApiKey}" placeholder="请输入语音接口密钥" />
                  </div>
                </div>
                <div class="sma-grid">
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsModel">模型</label>
                    <input type="text" id="${MODULE_NAME}_ttsModel" class="text_pole sma-field" value="${ttsModel}" placeholder="例如：speech-2.8-hd" />
                  </div>
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsVoiceId">音色 ID / Voice</label>
                    <input type="text" id="${MODULE_NAME}_ttsVoiceId" class="text_pole sma-field" value="${ttsVoiceId}" placeholder="例如：female-tianmei" />
                  </div>
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsFormat">音频格式</label>
                    <select id="${MODULE_NAME}_ttsFormat" class="text_pole sma-field">
                      <option value="mp3" ${ttsFormat === 'mp3' ? 'selected' : ''}>mp3</option>
                      <option value="wav" ${ttsFormat === 'wav' ? 'selected' : ''}>wav</option>
                      <option value="flac" ${ttsFormat === 'flac' ? 'selected' : ''}>flac</option>
                    </select>
                  </div>
                </div>
                <div class="sma-grid">
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsSpeed">语速</label>
                    <input type="number" id="${MODULE_NAME}_ttsSpeed" class="text_pole sma-field" value="${ttsSpeed}" step="0.1" />
                  </div>
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsVolume">音量</label>
                    <input type="number" id="${MODULE_NAME}_ttsVolume" class="text_pole sma-field" value="${ttsVolume}" step="0.1" />
                  </div>
                  <div>
                    <label class="sma-label" for="${MODULE_NAME}_ttsPitch">音高</label>
                    <input type="number" id="${MODULE_NAME}_ttsPitch" class="text_pole sma-field" value="${ttsPitch}" step="0.1" />
                  </div>
                </div>
              </div>
            </div>

            <div class="extension-content-item sma-stack">
              <div class="flex flexFlowColumn">
                <div class="settings-title-text">TTS 试听</div>
                <input type="text" id="${MODULE_NAME}_ttsTestText" class="text_pole sma-field" value="${ttsTestText}" placeholder="输入一段文本后点击试听" />
                <div class="sma-button-row">
                  <button id="${MODULE_NAME}_ttsTestBtn" class="menu_button" type="button">试听</button>
                  <button id="${MODULE_NAME}_ttsStopBtn" class="menu_button" type="button">停止</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 绑定收缩栏事件
 */
function bindCollapsibleEvents() {
  const STORAGE_KEY = 'smart-media-assistant-collapsed';

  const $root = $('#smart-media-assistant-settings .inline-drawer');
  const $toggle = $root.find('.inline-drawer-toggle');
  const $content = $root.find('.inline-drawer-content');
  const $icon = $root.find('.inline-drawer-icon');
  if ($root.length === 0 || $toggle.length === 0) {
    return;
  }

  // 防抖：避免同一次点击在冒泡阶段被其它全局处理器再次触发而立刻收起
  let toggleLock = false;

  function setCollapsed(collapsed) {
    if (collapsed) {
      $content.hide();
      $icon.removeClass('down').addClass('right');
    } else {
      $content.show();
      $icon.removeClass('right').addClass('down');
    }
    $toggle.attr('aria-expanded', (!collapsed).toString());
    localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
  }

  // 初始状态
  const collapsed = localStorage.getItem(STORAGE_KEY) === 'true';
  setCollapsed(collapsed);

  // 点击切换（使用 mousedown 并阻止冒泡，避免被外部“点击外部关闭”逻辑立即折叠）
  $toggle
    .off('.sma')
    .attr('role', 'button')
    .attr('tabindex', '0')
    .on('mousedown.sma', function (e) {
      // 阻止事件继续冒泡到全局 click 监听，从而避免打开后被立即关闭
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

      if (toggleLock) return; // 防抖
      toggleLock = true;

      const willCollapse = $content.is(':visible');
      setCollapsed(willCollapse);
      if (pluginConfig.enableLogging) {
        console.log(`[Smart Media Assistant] 设置面板${willCollapse ? '收缩' : '展开'}`);
      }

      // 短暂解锁，避免同一次点击流程里的其它监听再次触发
      setTimeout(() => (toggleLock = false), 200);
    })
    .on('click.sma', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    })
    .on('keydown.sma', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      $(this).trigger('mousedown');
    });
}

function syncTtsFormState() {
  const provider = pluginConfig.ttsProvider || 'browser';
  const isBrowser = provider === 'browser';
  const remoteSelectors = [
    `#${MODULE_NAME}_ttsApiUrl`,
    `#${MODULE_NAME}_ttsApiKey`,
    `#${MODULE_NAME}_ttsModel`,
    `#${MODULE_NAME}_ttsVoiceId`,
    `#${MODULE_NAME}_ttsFormat`,
    `#${MODULE_NAME}_ttsSpeed`,
    `#${MODULE_NAME}_ttsVolume`,
    `#${MODULE_NAME}_ttsPitch`,
  ];

  remoteSelectors.forEach((selector) => $(selector).prop('disabled', isBrowser || !pluginConfig.enableTTS));
  $(`#${MODULE_NAME}_ttsTestBtn`).prop('disabled', !pluginConfig.enableTTS);
  $(`#${MODULE_NAME}_ttsStopBtn`).prop('disabled', !pluginConfig.enableTTS);

  let helpText = '浏览器系统语音不需要接口配置，会直接调用当前设备可用的系统语音。';
  if (provider === 'minimax') {
    helpText =
      'MiniMax 使用官方 HTTP TTS 接口。接口地址可以填写域名，也可以直接填写完整的 /v1/t2a_v2 地址。';
  } else if (provider === 'openai-compatible') {
    helpText = 'OpenAI 兼容模式通常填写完整的 /audio/speech 地址，并使用 voice + model 进行合成。';
  }

  $(`#${MODULE_NAME}_ttsRemoteHint`).text(helpText);
}

/**
 * 绑定事件监听器
 */
function bindEventListeners() {
  // 监听设置变化
  $(document).on('change', `#${MODULE_NAME}_enableImageProcessing`, function () {
    pluginConfig.enableImageProcessing = $(this).prop('checked');
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_enableDocumentProcessing`, function () {
    pluginConfig.enableDocumentProcessing = $(this).prop('checked');
    saveSettings();
  });

  $(document).on('input', `#${MODULE_NAME}_imageQuality`, function () {
    const value = parseInt($(this).val());
    pluginConfig.imageQuality = value;
    $(`#${MODULE_NAME}_imageQualityValue`).text(value);
    saveSettings();
  });

  $(document).on('input', `#${MODULE_NAME}_maxImageDimension`, function () {
    const value = parseInt($(this).val());
    pluginConfig.maxImageDimension = value;
    $(`#${MODULE_NAME}_maxImageDimensionValue`).text(value);
    saveSettings();
  });

  $(document).on('input', `#${MODULE_NAME}_maxFileSize`, function () {
    const value = parseInt($(this).val());
    pluginConfig.maxFileSize = value;
    $(`#${MODULE_NAME}_maxFileSizeValue`).text(value);
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_enableAIReading`, function () {
    pluginConfig.enableAIReading = $(this).prop('checked');
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_showProcessingInfo`, function () {
    pluginConfig.showProcessingInfo = $(this).prop('checked');
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_enableLogging`, function () {
    pluginConfig.enableLogging = $(this).prop('checked');
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_enableTTS`, function () {
    pluginConfig.enableTTS = $(this).prop('checked');
    syncTtsFormState();
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_ttsProvider`, function () {
    pluginConfig.ttsProvider = String($(this).val() || 'browser');
    if (!pluginConfig.ttsApiUrl) {
      pluginConfig.ttsApiUrl = getDefaultTtsApiUrl(pluginConfig.ttsProvider);
      $(`#${MODULE_NAME}_ttsApiUrl`).val(pluginConfig.ttsApiUrl);
    }
    if (!pluginConfig.ttsModel) {
      pluginConfig.ttsModel = getDefaultTtsModel(pluginConfig.ttsProvider);
      $(`#${MODULE_NAME}_ttsModel`).val(pluginConfig.ttsModel);
    }
    syncTtsFormState();
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsApiUrl`, function () {
    pluginConfig.ttsApiUrl = String($(this).val() || '').trim();
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsApiKey`, function () {
    pluginConfig.ttsApiKey = String($(this).val() || '').trim();
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsModel`, function () {
    pluginConfig.ttsModel = String($(this).val() || '').trim();
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsVoiceId`, function () {
    pluginConfig.ttsVoiceId = String($(this).val() || '').trim();
    saveSettings();
  });

  $(document).on('change', `#${MODULE_NAME}_ttsFormat`, function () {
    pluginConfig.ttsFormat = String($(this).val() || 'mp3');
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsSpeed`, function () {
    pluginConfig.ttsSpeed = coerceNumber($(this).val(), 1);
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsVolume`, function () {
    pluginConfig.ttsVolume = coerceNumber($(this).val(), 1);
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsPitch`, function () {
    pluginConfig.ttsPitch = coerceNumber($(this).val(), 0);
    saveSettings();
  });

  $(document).on('input change', `#${MODULE_NAME}_ttsTestText`, function () {
    pluginConfig.ttsTestText = String($(this).val() || '');
    saveSettings();
  });

  $(document).on('click', `#${MODULE_NAME}_ttsTestBtn`, async function () {
    try {
      await speakTextWithConfiguredProvider(pluginConfig.ttsTestText || '你好，这是一段 TTS 试听内容。', {
        source: 'plugin-test',
      });
      if (typeof toastr !== 'undefined') {
        toastr.success('TTS 已开始播放', '语音朗读');
      }
    } catch (error) {
      if (typeof toastr !== 'undefined') {
        toastr.error(error.message || String(error), 'TTS 试听失败');
      }
    }
  });

  $(document).on('click', `#${MODULE_NAME}_ttsStopBtn`, function () {
    stopSpeaking();
  });
}

/**
 * 保存设置
 */
function saveSettings() {
  const context = typeof getContext === 'function' ? getContext() : null;
  if (!context) return;
  context.extensionSettings = context.extensionSettings || {};
  context.extensionSettings[MODULE_NAME] = pluginConfig;
  saveSettingsDebounced();

  if (pluginConfig.enableLogging) {
    console.log('[Smart Media Assistant] 设置已保存:', pluginConfig);
  }
}

// ==================== 插件入口 ====================

// jQuery ready
$(document).ready(function () {
  initPlugin();
});

// 导出模块（如果需要）
// Smart Media Assistant: minimal global bridge
function sanitizeForSlash(text) {
  if (!text) return '';
  return String(text).replaceAll('|', '¦');
}
async function loadSlashCommandsModule() {
  const candidates = [
    '/scripts/slash-commands.js',
    '../../scripts/slash-commands.js',
    '../../../scripts/slash-commands.js',
    '../../../../scripts/slash-commands.js',
  ];
  for (const p of candidates) {
    try {
      const mod = await import(p);
      if (mod && typeof mod.executeSlashCommandsWithOptions === 'function') {
        return mod;
      }
    } catch (e) {}
  }
  return null;
}
async function sendTextToSillyTavern(content) {
  const cmd = `/send ${content} | /trigger`;
  try {
    const mod = await loadSlashCommandsModule();
    if (mod && typeof mod.executeSlashCommandsWithOptions === 'function') {
      await mod.executeSlashCommandsWithOptions(cmd, {
        handleParserErrors: true,
        handleExecutionErrors: true,
        source: MODULE_NAME,
      });
      return true;
    }
  } catch (e) {}
  try {
    if (typeof window.triggerSlash === 'function') {
      window.triggerSlash(cmd);
      return true;
    }
  } catch (e) {}
  console.warn('[Smart Media Assistant] 无法找到 slash-commands 或 triggerSlash，发送失败');
  return false;
}
async function processTextBridge(text, options = {}) {
  const name = options?.name || '文本';
  const header = options?.prompt || `请阅读并总结以下文件 ${name} 的关键信息：`;
  const safe = sanitizeForSlash(text);
  const content = `${header}\n\n${safe}`;
  if (pluginConfig.enableLogging) {
    console.log('[Smart Media Assistant] 发送文档至酒馆以生成总结', { name, size: options?.size });
  }
  return await sendTextToSillyTavern(content);
}

function sanitizeTtsText(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .replace(/\u200b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureTtsAudioElement() {
  if (ttsPlaybackState.audioElement) return ttsPlaybackState.audioElement;
  const audio = document.createElement('audio');
  audio.id = `${MODULE_NAME}-tts-audio`;
  audio.preload = 'none';
  audio.style.display = 'none';
  audio.addEventListener('ended', () => {
    ttsPlaybackState.isSpeaking = false;
    ttsPlaybackState.activeMode = '';
    if (ttsPlaybackState.currentObjectUrl) {
      URL.revokeObjectURL(ttsPlaybackState.currentObjectUrl);
      ttsPlaybackState.currentObjectUrl = '';
    }
  });
  audio.addEventListener('error', () => {
    ttsPlaybackState.isSpeaking = false;
    ttsPlaybackState.activeMode = '';
  });
  document.body.appendChild(audio);
  ttsPlaybackState.audioElement = audio;
  return audio;
}

function stopSpeaking() {
  try {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  } catch (e) {}

  const audio = ttsPlaybackState.audioElement;
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (e) {}
  }

  if (ttsPlaybackState.currentObjectUrl) {
    URL.revokeObjectURL(ttsPlaybackState.currentObjectUrl);
    ttsPlaybackState.currentObjectUrl = '';
  }
  ttsPlaybackState.activeMode = '';
  ttsPlaybackState.isSpeaking = false;
}

function pickBrowserVoice(keyword) {
  if (typeof speechSynthesis === 'undefined' || typeof speechSynthesis.getVoices !== 'function') return null;
  const voices = speechSynthesis.getVoices() || [];
  const needle = String(keyword || '').trim().toLowerCase();
  if (needle) {
    const matched = voices.find((voice) => String(voice.name || '').toLowerCase().includes(needle));
    if (matched) return matched;
  }
  return voices.find((voice) => String(voice.lang || '').toLowerCase().startsWith('zh')) || voices[0] || null;
}

function playViaBrowserSpeech(text) {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    throw new Error('当前浏览器不支持 speechSynthesis');
  }

  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickBrowserVoice(pluginConfig.ttsVoiceId);
  if (voice) utterance.voice = voice;
  utterance.rate = clamp(coerceNumber(pluginConfig.ttsSpeed, 1), 0.1, 10);
  utterance.volume = clamp(coerceNumber(pluginConfig.ttsVolume, 1), 0, 1);
  utterance.pitch = clamp(1 + coerceNumber(pluginConfig.ttsPitch, 0) * 0.1, 0, 2);
  utterance.onstart = () => {
    ttsPlaybackState.activeMode = 'browser';
    ttsPlaybackState.isSpeaking = true;
  };
  utterance.onend = () => {
    ttsPlaybackState.activeMode = '';
    ttsPlaybackState.isSpeaking = false;
  };
  utterance.onerror = () => {
    ttsPlaybackState.activeMode = '';
    ttsPlaybackState.isSpeaking = false;
  };
  speechSynthesis.speak(utterance);
}

function normalizeMiniMaxTtsUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  const fallback = 'https://api.minimax.io/v1/t2a_v2';
  if (!value) return fallback;
  if (/\/v1\/t2a_v2\/?$/i.test(value)) return value;
  return `${value.replace(/\/+$/, '')}/v1/t2a_v2`;
}

function hexToBlobUrl(hex, format = 'mp3') {
  const cleanHex = String(hex || '').replace(/\s+/g, '');
  if (!cleanHex) {
    throw new Error('语音接口未返回音频数据');
  }
  if (cleanHex.length % 2 !== 0) {
    throw new Error('返回的十六进制音频长度不合法');
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }

  const mimeMap = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
  };
  const blob = new Blob([bytes], { type: mimeMap[format] || 'audio/mpeg' });
  return URL.createObjectURL(blob);
}

async function parseRemoteError(response, fallbackMessage) {
  const rawText = await response.text();
  if (!rawText) return `${fallbackMessage}: ${response.status} ${response.statusText}`;

  try {
    const json = JSON.parse(rawText);
    const message =
      json?.base_resp?.status_msg ||
      json?.error?.message ||
      json?.message ||
      json?.msg ||
      rawText;
    return `${fallbackMessage}: ${message}`;
  } catch (e) {
    return `${fallbackMessage}: ${rawText}`;
  }
}

async function synthesizeMiniMaxSpeech(text) {
  const apiKey = String(pluginConfig.ttsApiKey || '').trim();
  const voiceId = String(pluginConfig.ttsVoiceId || '').trim();
  if (!apiKey) throw new Error('请先填写 MiniMax API Key');
  if (!voiceId) throw new Error('请先填写 MiniMax 音色 ID');

  const response = await fetch(normalizeMiniMaxTtsUrl(pluginConfig.ttsApiUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: String(pluginConfig.ttsModel || '').trim() || 'speech-2.8-hd',
      text,
      stream: false,
      language_boost: 'auto',
      output_format: 'hex',
      voice_setting: {
        voice_id: voiceId,
        speed: coerceNumber(pluginConfig.ttsSpeed, 1),
        vol: coerceNumber(pluginConfig.ttsVolume, 1),
        pitch: coerceNumber(pluginConfig.ttsPitch, 0),
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: String(pluginConfig.ttsFormat || 'mp3').trim() || 'mp3',
        channel: 1,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseRemoteError(response, 'MiniMax TTS 请求失败，请检查地址、密钥或是否存在跨域限制'),
    );
  }

  const data = await response.json();
  const statusCode = data?.base_resp?.status_code;
  if (Number.isFinite(statusCode) && statusCode !== 0) {
    throw new Error(data?.base_resp?.status_msg || 'MiniMax TTS 返回错误');
  }

  return {
    url: hexToBlobUrl(data?.data?.audio, pluginConfig.ttsFormat || 'mp3'),
    revokeAfterUse: true,
  };
}

async function synthesizeOpenAICompatibleSpeech(text) {
  const apiUrl = String(pluginConfig.ttsApiUrl || '').trim();
  const apiKey = String(pluginConfig.ttsApiKey || '').trim();
  const model = String(pluginConfig.ttsModel || '').trim();
  const voiceId = String(pluginConfig.ttsVoiceId || '').trim();
  if (!apiUrl) throw new Error('请先填写 OpenAI 兼容 TTS 接口地址');
  if (!apiKey) throw new Error('请先填写 OpenAI 兼容 TTS 的 API Key');
  if (!model) throw new Error('请先填写 OpenAI 兼容 TTS 的模型名');
  if (!voiceId) throw new Error('请先填写 OpenAI 兼容 TTS 的 voice');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      voice: voiceId,
      input: text,
      response_format: String(pluginConfig.ttsFormat || 'mp3').trim() || 'mp3',
      speed: coerceNumber(pluginConfig.ttsSpeed, 1),
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseRemoteError(response, 'OpenAI 兼容 TTS 请求失败，请检查地址、密钥或返回格式'),
    );
  }

  const blob = await response.blob();
  if (!blob || !blob.size) {
    throw new Error('OpenAI 兼容 TTS 未返回音频数据');
  }

  return {
    url: URL.createObjectURL(blob),
    revokeAfterUse: true,
  };
}

async function playRemoteTtsAudio(source) {
  const audio = ensureTtsAudioElement();
  stopSpeaking();
  if (source.revokeAfterUse) {
    ttsPlaybackState.currentObjectUrl = source.url;
  }
  audio.src = source.url;
  audio.currentTime = 0;
  ttsPlaybackState.activeMode = 'audio';
  ttsPlaybackState.isSpeaking = true;
  try {
    await audio.play();
  } catch (error) {
    if (ttsPlaybackState.currentObjectUrl) {
      URL.revokeObjectURL(ttsPlaybackState.currentObjectUrl);
      ttsPlaybackState.currentObjectUrl = '';
    }
    ttsPlaybackState.activeMode = '';
    ttsPlaybackState.isSpeaking = false;
    throw error;
  }
}

async function speakTextWithConfiguredProvider(text, options = {}) {
  if (!pluginConfig.enableTTS) {
    throw new Error('TTS 功能已关闭，请先在插件设置中开启');
  }

  const cleanText = sanitizeTtsText(text);
  if (!cleanText) {
    throw new Error('没有可用于朗读的文本');
  }

  const provider = options.provider || pluginConfig.ttsProvider || 'browser';
  if (pluginConfig.enableLogging) {
    console.log('[Smart Media Assistant] TTS 开始朗读', {
      provider,
      length: cleanText.length,
      source: options?.source || 'unknown',
    });
  }

  if (provider === 'browser') {
    playViaBrowserSpeech(cleanText);
    return { success: true, provider, mode: 'browser' };
  }

  const source =
    provider === 'minimax'
      ? await synthesizeMiniMaxSpeech(cleanText)
      : await synthesizeOpenAICompatibleSpeech(cleanText);

  await playRemoteTtsAudio(source);
  return { success: true, provider, mode: 'audio' };
}

function getTtsStatus() {
  const speechActive =
    typeof speechSynthesis !== 'undefined' &&
    (speechSynthesis.speaking || speechSynthesis.pending || speechSynthesis.paused);

  return {
    enabled: !!pluginConfig.enableTTS,
    provider: pluginConfig.ttsProvider || 'browser',
    isSpeaking: !!ttsPlaybackState.isSpeaking || !!speechActive,
    activeMode: ttsPlaybackState.activeMode || (speechActive ? 'browser' : ''),
  };
}

function showTtsToast(message, level = 'info') {
  if (typeof toastr === 'undefined') return;
  if (level === 'error') {
    toastr.error(message, 'TTS');
    return;
  }
  if (level === 'success') {
    toastr.success(message, 'TTS');
    return;
  }
  toastr.info(message, 'TTS');
}

function normalizeMessageId(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
}

function rememberNativeTtsMessageId(messageId) {
  const normalizedId = normalizeMessageId(messageId);
  if (normalizedId !== null) {
    nativeTtsIntegrationState.lastMessageId = normalizedId;
  }
  return normalizedId;
}

function getChatMessageById(messageId) {
  const context = getPluginContextSafe();
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const normalizedId = normalizeMessageId(messageId);
  if (normalizedId === null || normalizedId >= chat.length) return null;
  return chat[normalizedId] || null;
}

function stripHtmlToText(html) {
  if (typeof document === 'undefined') return String(html ?? '');
  const div = document.createElement('div');
  div.innerHTML = String(html ?? '');
  return div.textContent || div.innerText || '';
}

function getRawChatMessageText(message) {
  if (!message) return '';
  let text = message?.extra?.display_text ?? message?.mes ?? '';
  text = String(text ?? '');
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = stripHtmlToText(text);
  }
  return sanitizeTtsText(text);
}

function getRenderedChatMessageText(messageId) {
  if (typeof document === 'undefined') return '';
  const normalizedId = normalizeMessageId(messageId);
  if (normalizedId === null) return '';
  const textElement = document.querySelector(`#chat .mes[mesid="${normalizedId}"] .mes_text`);
  if (!textElement) return '';

  const clone = textElement.cloneNode(true);
  if (clone.querySelectorAll) {
    clone.querySelectorAll('script, style').forEach((node) => node.remove());
  }

  return sanitizeTtsText(clone.textContent || clone.innerText || '');
}

function getChatMessageContentText(messageId) {
  const rendered = getRenderedChatMessageText(messageId);
  if (rendered && rendered !== '...') return rendered;

  const message = getChatMessageById(messageId);
  const raw = getRawChatMessageText(message);
  return raw !== '...' ? raw : '';
}

function joinQuotedBlocks(text, options = {}) {
  const {
    separator = ' ... ',
    includeQuotes = false,
    returnEmptyOnNoQuotes = false,
    pairs = [
      ['„', '“'],
      ['“', '”'],
      ['«', '»'],
      ['»', '«'],
      ['‘', '’'],
      ['‚', '‘'],
      ['「', '」'],
      ['『', '』'],
      ['"', '"'],
      ['＂', '＂'],
    ],
  } = options;

  if (!text || typeof text !== 'string') return text;

  const openToClose = Object.fromEntries(pairs);
  const segments = [];
  const stack = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const top = stack[stack.length - 1];

    if (top && char === top.expectedClose) {
      const finished = stack.pop();
      if (stack.length === 0) {
        segments.push(text.slice(finished.start, i + 1));
      }
      continue;
    }

    if (openToClose[char]) {
      stack.push({ opener: char, expectedClose: openToClose[char], start: i });
    }
  }

  if (!segments.length) return returnEmptyOnNoQuotes ? '' : text;
  const cleaned = includeQuotes ? segments : segments.map((segment) => segment.slice(1, -1));
  return cleaned.join(separator);
}

function getChatMessageQuotedText(messageId) {
  const text = getChatMessageContentText(messageId);
  if (!text) return '';
  return sanitizeTtsText(
    joinQuotedBlocks(text, {
      separator: ' ... ',
      includeQuotes: false,
      returnEmptyOnNoQuotes: true,
    }),
  );
}

function isNarratableChatMessage(message) {
  if (!message || message.is_system) return false;
  const content = getRawChatMessageText(message);
  return !!content && content !== '...';
}

function getLatestNarratableMessageId() {
  const context = getPluginContextSafe();
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  for (let index = chat.length - 1; index >= 0; index -= 1) {
    if (!isNarratableChatMessage(chat[index])) continue;
    return index;
  }
  return null;
}

function resolveTargetMessageId(preferredId = null) {
  const explicitId = normalizeMessageId(preferredId);
  if (explicitId !== null && getChatMessageById(explicitId)) {
    return explicitId;
  }

  const rememberedId = normalizeMessageId(nativeTtsIntegrationState.lastMessageId);
  if (rememberedId !== null && getChatMessageById(rememberedId)) {
    return rememberedId;
  }

  return getLatestNarratableMessageId();
}

async function speakChatMessageById(messageId, mode = 'content', options = {}) {
  const resolvedId = resolveTargetMessageId(messageId);
  if (resolvedId === null) {
    throw new Error('未找到可朗读的消息');
  }

  rememberNativeTtsMessageId(resolvedId);
  const text =
    mode === 'quote' ? getChatMessageQuotedText(resolvedId) : getChatMessageContentText(resolvedId);

  if (!text) {
    throw new Error(mode === 'quote' ? '这条消息里没有双引号内容' : '这条消息没有可朗读的正文');
  }

  return await speakTextWithConfiguredProvider(text, {
    ...options,
    source: options?.source || `st-chat-${mode}`,
    messageId: resolvedId,
    mode,
  });
}

function createNativeTtsActionButton(action, title, iconClass) {
  return $(`
    <div
      title="${escapeHtmlAttr(title)}"
      class="mes_button sma_tts_action ${escapeHtmlAttr(iconClass)}"
      data-sma-tts-action="${escapeHtmlAttr(action)}"
    ></div>
  `);
}

function renderNativeTtsButtons() {
  if (typeof document === 'undefined' || typeof $ !== 'function') return;

  $('#chat .mes').each(function () {
    const $message = $(this);
    const messageId = normalizeMessageId($message.attr('mesid'));
    if (messageId === null) return;
    const chatMessage = getChatMessageById(messageId);
    if (!chatMessage || chatMessage.is_system) return;

    const $container = $message.find('.extraMesButtons').first();
    if ($container.length === 0) return;

    if ($container.find('[data-sma-tts-action="content"]').length === 0) {
      createNativeTtsActionButton('content', '朗读正文', 'fa-solid fa-bullhorn').appendTo($container);
    }
    if ($container.find('[data-sma-tts-action="quote"]').length === 0) {
      createNativeTtsActionButton('quote', '朗读双引号内容', 'fa-solid fa-quote-right').appendTo($container);
    }
    if ($container.find('[data-sma-tts-action="stop"]').length === 0) {
      createNativeTtsActionButton('stop', '停止朗读', 'fa-solid fa-stop').appendTo($container);
    }
  });
}

function queueNativeTtsButtonsRefresh(delay = 0) {
  if (nativeTtsIntegrationState.renderTimer) {
    clearTimeout(nativeTtsIntegrationState.renderTimer);
  }
  nativeTtsIntegrationState.renderTimer = setTimeout(() => {
    nativeTtsIntegrationState.renderTimer = null;
    renderNativeTtsButtons();
  }, delay);
}

function closeNativeTtsActions(triggerElement) {
  const $buttons = $(triggerElement).closest('.extraMesButtons');
  if ($buttons.length === 0) return;

  $buttons.hide().removeClass('visible').css('opacity', '');
  $buttons.siblings('.extraMesButtonsHint').show().css('opacity', '');
}

function bindNativeTtsMenuEvents() {
  if (nativeTtsIntegrationState.domEventsBound || typeof $ !== 'function') return;
  nativeTtsIntegrationState.domEventsBound = true;

  $(document).off('.smaTtsNative');

  $(document).on('click.smaTtsNative', '.extraMesButtonsHint', function () {
    rememberNativeTtsMessageId($(this).closest('.mes').attr('mesid'));
  });

  $(document).on('click.smaTtsNative', '[data-sma-tts-action]', async function (event) {
    event.preventDefault();
    event.stopPropagation();

    const $target = $(this);
    const action = String($target.attr('data-sma-tts-action') || '').trim();
    const messageId = rememberNativeTtsMessageId($target.closest('.mes').attr('mesid'));

    closeNativeTtsActions(this);

    try {
      if (action === 'stop') {
        stopSpeaking();
        showTtsToast('已停止朗读');
        return;
      }

      if (action === 'quote') {
        await speakChatMessageById(messageId, 'quote', { source: 'st-native-menu' });
        showTtsToast('开始朗读双引号内容', 'success');
        return;
      }

      await speakChatMessageById(messageId, 'content', { source: 'st-native-menu' });
      showTtsToast('开始朗读消息正文', 'success');
    } catch (error) {
      showTtsToast(error.message || String(error), 'error');
    }
  });
}

function bindNativeTtsContextEvents() {
  if (nativeTtsIntegrationState.contextEventsBound) return;
  const context = getPluginContextSafe();
  if (!context?.eventSource || !context?.eventTypes) return;

  nativeTtsIntegrationState.contextEventsBound = true;
  const refresh = () => queueNativeTtsButtonsRefresh(0);
  const events = [
    context.eventTypes.CHAT_CHANGED,
    context.eventTypes.MESSAGE_RECEIVED,
    context.eventTypes.MESSAGE_UPDATED,
    context.eventTypes.MESSAGE_EDITED,
    context.eventTypes.MESSAGE_SWIPED,
  ].filter(Boolean);

  events.forEach((eventName) => context.eventSource.on(eventName, refresh));
}

function observeNativeChatDom() {
  if (nativeTtsIntegrationState.chatObserver || typeof MutationObserver === 'undefined') return;
  const chatNode = document.getElementById('chat');
  if (!chatNode) return;

  nativeTtsIntegrationState.chatObserver = new MutationObserver(() => {
    queueNativeTtsButtonsRefresh(10);
  });
  nativeTtsIntegrationState.chatObserver.observe(chatNode, {
    childList: true,
    subtree: true,
  });
}

function normalizeTtsSlashMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';

  const contentModes = ['当前消息', '当前', '正文', '内容', 'message', 'current', 'latest', 'last', 'content', 'text'];
  if (contentModes.includes(normalized)) return 'content';

  const quoteModes = ['引号', '双引号', 'quote', 'quotes', 'quoted', 'dialogue', 'dialog'];
  if (quoteModes.includes(normalized)) return 'quote';

  const stopModes = ['停止', '停止朗读', 'stop', 'end', 'cancel'];
  if (stopModes.includes(normalized)) return 'stop';

  return '';
}

async function handleTtsSlashCommand(args = {}, value = '') {
  const modeFromArgs = normalizeTtsSlashMode(args?.mode);
  const rawValue = sanitizeTtsText(value);
  const explicitMessageId = normalizeMessageId(args?.id);

  try {
    if (modeFromArgs === 'stop') {
      stopSpeaking();
      showTtsToast('已停止朗读');
      return '';
    }

    if (modeFromArgs === 'content' || modeFromArgs === 'quote') {
      await speakChatMessageById(explicitMessageId, modeFromArgs, { source: 'slash-tts' });
      showTtsToast(modeFromArgs === 'quote' ? '开始朗读双引号内容' : '开始朗读消息正文', 'success');
      return '';
    }

    const inlineMode = normalizeTtsSlashMode(rawValue);
    if (inlineMode === 'stop') {
      stopSpeaking();
      showTtsToast('已停止朗读');
      return '';
    }

    if (inlineMode === 'content' || inlineMode === 'quote') {
      await speakChatMessageById(explicitMessageId, inlineMode, { source: 'slash-tts' });
      showTtsToast(inlineMode === 'quote' ? '开始朗读双引号内容' : '开始朗读消息正文', 'success');
      return '';
    }

    if (rawValue) {
      await speakTextWithConfiguredProvider(rawValue, { source: 'slash-tts-direct' });
      showTtsToast('开始朗读文本内容', 'success');
      return '';
    }

    await speakChatMessageById(explicitMessageId, 'content', { source: 'slash-tts' });
    showTtsToast('开始朗读消息正文', 'success');
    return '';
  } catch (error) {
    showTtsToast(error.message || String(error), 'error');
    return '';
  }
}

function createTtsSlashCommand() {
  const context = getPluginContextSafe();
  if (!context?.SlashCommand || !context?.ARGUMENT_TYPE) return null;

  const SlashCommand = context.SlashCommand;
  const SlashCommandArgument = context.SlashCommandArgument;
  const SlashCommandNamedArgument = context.SlashCommandNamedArgument;
  const ARGUMENT_TYPE = context.ARGUMENT_TYPE;

  return SlashCommand.fromProps({
    name: 'tts',
    aliases: ['smart-tts', 'sma-tts'],
    callback: async (args, rawValue) => await handleTtsSlashCommand(args, rawValue),
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'mode',
        description: '可选：当前消息 / 引号 / 停止',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'id',
        description: '可选：指定消息 ID；不填时优先使用最近打开过菜单的消息，否则回退到最后一条可朗读消息',
        typeList: [ARGUMENT_TYPE.NUMBER],
        isRequired: false,
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: '模式关键字，或要直接朗读的任意文本',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
    helpString: `
      <div>朗读当前聊天里的消息正文、双引号内容，或直接朗读传入文本。</div>
      <div><strong>示例：</strong></div>
      <ul>
        <li><pre><code>/tts 当前消息</code></pre></li>
        <li><pre><code>/tts 引号</code></pre></li>
        <li><pre><code>/tts mode=quote id=12</code></pre></li>
        <li><pre><code>/tts 你好，今天过得怎么样？</code></pre></li>
        <li><pre><code>/tts 停止</code></pre></li>
      </ul>
      <div>说明：SillyTavern 自带的 <code>/speak</code> 仍然保留；这里只是把 <code>/tts</code> 别名重定向到本插件。</div>
    `,
  });
}

function installTtsSlashCommand(forceAlias = false) {
  const context = getPluginContextSafe();
  if (!context?.SlashCommandParser) return;

  if (!nativeTtsIntegrationState.slashCommandObject) {
    nativeTtsIntegrationState.slashCommandObject = createTtsSlashCommand();
  }

  const command = nativeTtsIntegrationState.slashCommandObject;
  if (!command) return;

  if (!nativeTtsIntegrationState.slashCommandRegistered) {
    context.SlashCommandParser.addCommandObject(command);
    nativeTtsIntegrationState.slashCommandRegistered = true;
  }

  if (forceAlias || context.SlashCommandParser.commands?.tts !== command) {
    context.SlashCommandParser.commands[command.name] = command;
    for (const alias of command.aliases || []) {
      context.SlashCommandParser.commands[alias] = command;
    }
  }
}

function initNativeTtsIntegrations() {
  bindNativeTtsMenuEvents();
  bindNativeTtsContextEvents();
  observeNativeChatDom();
  queueNativeTtsButtonsRefresh(0);
  installTtsSlashCommand(true);
  setTimeout(() => installTtsSlashCommand(true), 1000);
}

function exposeGlobalBridge() {
  try {
    const target = typeof window !== 'undefined' ? window : globalThis;
    target.smartMediaAssistant = target.smartMediaAssistant || {};
    if (typeof target.smartMediaAssistant.processText !== 'function') {
      target.smartMediaAssistant.processText = (text, options) => processTextBridge(text, options);
      if (pluginConfig.enableLogging) {
        console.log('[Smart Media Assistant] 已暴露桥接: smartMediaAssistant.processText');
      }
    }
    target.smartMediaAssistant.speakText = (text, options) => speakTextWithConfiguredProvider(text, options);
    target.smartMediaAssistant.speakChatMessageById = (messageId, mode, options) =>
      speakChatMessageById(messageId, mode, options);
    target.smartMediaAssistant.stopSpeaking = () => stopSpeaking();
    target.smartMediaAssistant.getTtsStatus = () => getTtsStatus();
  } catch (e) {
    console.warn('[Smart Media Assistant] 暴露全局桥接失败', e);
  }
}
try {
  exposeGlobalBridge();
} catch (e) {}
export { DocumentProcessor, FileProcessor, FileTypeDetector, FileValidator, ImageProcessor };
