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
let pluginConfig = {};

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
  `;
  document.head.appendChild(style);
}

/**
 * 创建设置界面HTML
 */
function createSettingsHTML() {
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
  } catch (e) {
    console.warn('[Smart Media Assistant] 暴露全局桥接失败', e);
  }
}
try {
  exposeGlobalBridge();
} catch (e) {}
export { DocumentProcessor, FileProcessor, FileTypeDetector, FileValidator, ImageProcessor };
