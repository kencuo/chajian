/**
 * 智能媒体助手 - SillyTavern Extension
 * 统一的图片和文档处理插件
 * 作者: kencuo
 * 版本: 1.0.0
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
  const context = getContext();
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
    const isImage = isImageByType || (fileType.startsWith('image/') && isImageByExt);

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
  static async processImage(file) {
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

            // 保存文件
            const base64Content = imageData.split(',')[1];
            const fileExtension = 'jpg';
            const uniqueId = `${Date.now()}_${getStringHash(file.name)}`;
            const storagePath = 'user/images';

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
          }
        };

        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = URL.createObjectURL(file);
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
        return await ImageProcessor.processImage(file);
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
 * 图片处理接口
 */
window.__uploadImageByPlugin = async function (file, options = {}) {
  return await ImageProcessor.processImage(file);
};

/**
 * 文档处理接口 - 增强版，集成SillyTavern文件处理能力
 */
window.__processDocumentByPlugin = async function (file, options = {}) {
  try {
    if (!file) {
      throw new Error('请提供文件');
    }

    const detection = FileTypeDetector.detectFileType(file);

    if (pluginConfig.enableLogging) {
      console.log('[Document Processor] 处理文档:', {
        name: file.name,
        type: file.type,
        size: file.size,
        detection: detection,
      });
    }

    let result = {
      success: false,
      type: detection.fileExtension,
      fileName: file.name,
      fileSize: file.size,
      timestamp: new Date().toISOString(),
    };

    let content = '';

    // 根据文件类型选择处理方式
    if (detection.fileExtension === 'pdf') {
      // PDF文件处理
      content = await window.__extractTextFromPDF(file);
      result.contentType = 'pdf';
    } else if (detection.fileExtension === 'json') {
      // JSON文件处理
      const jsonData = await window.__parseJsonFile(file);
      content = JSON.stringify(jsonData, null, 2);
      result.contentType = 'json';
      result.jsonData = jsonData;
    } else if (detection.isDocument) {
      // 其他文本文档处理
      content = await window.__readTextFile(file);
      result.contentType = 'text';
    } else {
      throw new Error(`不支持的文档类型: ${detection.fileType || '未知'} (${file.name})`);
    }

    result = {
      ...result,
      success: true,
      content: content,
      contentLength: content.length,
    };

    // AI分析（如果启用）
    if (options.enableAIReading && content) {
      try {
        const aiPrompt =
          options.aiPrompt || `请分析这个${detection.fileExtension.toUpperCase()}文档的主要内容，提供简洁的摘要。`;

        // 这里可以集成AI分析功能
        // 暂时返回基本分析信息
        const basicAnalysis = generateBasicDocumentAnalysis(content, detection.fileExtension);
        result.aiAnalysis = basicAnalysis;

        if (pluginConfig.enableLogging) {
          console.log('[Document Processor] AI分析完成');
        }
      } catch (aiError) {
        console.warn('[Document Processor] AI分析失败:', aiError);
        result.aiAnalysisError = aiError.message;
      }
    }

    return result;
  } catch (error) {
    console.error('[Document Processor] 处理失败:', error);
    return {
      success: false,
      error: error.message,
      fileName: file.name,
      timestamp: new Date().toISOString(),
    };
  }
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

// ==================== SillyTavern文件处理接口暴露 ====================

/**
 * 暴露SillyTavern的文件处理函数
 */

/**
 * 读取文本文件内容
 * @param {File} file 文件对象
 * @returns {Promise<string>} 文件文本内容
 */
window.__readTextFile = async function (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      resolve(e.target.result);
    };
    reader.onerror = function (error) {
      reject(error);
    };
    reader.readAsText(file, 'UTF-8');
  });
};

/**
 * 解析JSON文件
 * @param {File} file JSON文件
 * @returns {Promise<Object>} 解析后的JSON对象
 */
window.__parseJsonFile = async function (file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.readAsText(file);
    fileReader.onload = event => {
      try {
        const result = JSON.parse(String(event.target.result));
        resolve(result);
      } catch (error) {
        reject(new Error(`JSON解析失败: ${error.message}`));
      }
    };
    fileReader.onerror = error => reject(error);
  });
};

/**
 * 提取PDF文本内容
 * @param {File} file PDF文件
 * @returns {Promise<string>} 提取的文本内容
 */
window.__extractTextFromPDF = async function (file) {
  try {
    // 动态加载PDF.js库
    if (!('pdfjsLib' in window)) {
      // 尝试从SillyTavern加载PDF.js
      try {
        await import('./sillytavern 文件/SillyTavern-release/public/lib/pdf.min.mjs');
        await import('./sillytavern 文件/SillyTavern-release/public/lib/pdf.worker.min.mjs');
      } catch (e) {
        // 备用CDN加载
        await loadPDFLibrary();
      }
    }

    const buffer = await getFileBuffer(file);
    const pdf = await pdfjsLib.getDocument(buffer).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');
      pages.push(text);
    }

    return postProcessText(pages.join('\n'));
  } catch (error) {
    throw new Error(`PDF文本提取失败: ${error.message}`);
  }
};

/**
 * 获取文件缓冲区
 * @param {File} file 文件对象
 * @returns {Promise<ArrayBuffer>} 文件缓冲区
 */
async function getFileBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      resolve(e.target.result);
    };
    reader.onerror = function (error) {
      reject(error);
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 文本后处理
 * @param {string} text 原始文本
 * @param {boolean} removeNewlines 是否移除换行符
 * @returns {string} 处理后的文本
 */
function postProcessText(text, removeNewlines = true) {
  if (!text) return '';

  // 基本清理
  let processed = text.trim();

  // 移除多余的空白字符
  processed = processed.replace(/\s+/g, ' ');

  // 可选：移除换行符
  if (removeNewlines) {
    processed = processed.replace(/\n+/g, ' ');
  }

  return processed;
}

/**
 * 动态加载PDF.js库
 */
async function loadPDFLibrary() {
  const cdnUrls = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  ];

  for (const url of cdnUrls) {
    try {
      await loadScript(url);
      if ('pdfjsLib' in window) {
        // 设置worker路径
        const workerUrl = url.replace('pdf.min.js', 'pdf.worker.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        return;
      }
    } catch (error) {
      console.warn(`从 ${url} 加载PDF.js失败:`, error);
      continue;
    }
  }

  throw new Error('无法加载PDF.js库');
}

/**
 * 动态加载脚本
 */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载脚本: ${url}`));
    document.head.appendChild(script);
  });
}

/**
 * 生成基本文档分析
 * @param {string} content 文档内容
 * @param {string} fileType 文件类型
 * @returns {string} 分析结果
 */
function generateBasicDocumentAnalysis(content, fileType) {
  if (!content || content.trim().length === 0) {
    return '文档内容为空';
  }

  const wordCount = content.split(/\s+/).length;
  const charCount = content.length;
  const lineCount = content.split('\n').length;

  let analysis = `📊 文档基本信息：\n`;
  analysis += `• 文件类型：${fileType.toUpperCase()}\n`;
  analysis += `• 字符数：${charCount.toLocaleString()}\n`;
  analysis += `• 词数：${wordCount.toLocaleString()}\n`;
  analysis += `• 行数：${lineCount.toLocaleString()}\n\n`;

  // 根据文件类型提供特定分析
  if (fileType === 'json') {
    try {
      const jsonData = JSON.parse(content);
      analysis += `🔍 JSON结构分析：\n`;
      analysis += `• 根级属性数：${Object.keys(jsonData).length}\n`;
      analysis += `• 数据类型：${Array.isArray(jsonData) ? '数组' : '对象'}\n`;
      if (Array.isArray(jsonData)) {
        analysis += `• 数组长度：${jsonData.length}\n`;
      }
    } catch (e) {
      analysis += `⚠️ JSON格式验证：格式错误\n`;
    }
  } else if (fileType === 'pdf') {
    analysis += `📖 PDF文档分析：\n`;
    analysis += `• 文本提取：成功\n`;
    analysis += `• 内容类型：${detectContentType(content)}\n`;
  } else {
    analysis += `📝 文本内容分析：\n`;
    analysis += `• 内容类型：${detectContentType(content)}\n`;

    // 检测编程语言（如果是代码文件）
    const language = detectProgrammingLanguage(content, fileType);
    if (language) {
      analysis += `• 编程语言：${language}\n`;
    }
  }

  // 内容预览
  const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
  analysis += `\n📄 内容预览：\n${preview}`;

  return analysis;
}

/**
 * 检测内容类型
 */
function detectContentType(content) {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('function') || lowerContent.includes('class') || lowerContent.includes('import')) {
    return '代码文件';
  } else if (lowerContent.includes('http') || lowerContent.includes('www.')) {
    return '包含链接的文档';
  } else if (/\d{4}-\d{2}-\d{2}/.test(content)) {
    return '包含日期的文档';
  } else if (lowerContent.includes('error') || lowerContent.includes('exception')) {
    return '错误日志';
  } else {
    return '普通文本';
  }
}

/**
 * 检测编程语言
 */
function detectProgrammingLanguage(content, fileType) {
  const languageMap = {
    js: 'JavaScript',
    ts: 'TypeScript',
    py: 'Python',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    cs: 'C#',
    php: 'PHP',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    html: 'HTML',
    css: 'CSS',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML',
  };

  if (languageMap[fileType]) {
    return languageMap[fileType];
  }

  // 基于内容检测
  const lowerContent = content.toLowerCase();
  if (lowerContent.includes('function') && lowerContent.includes('var')) {
    return 'JavaScript';
  } else if (lowerContent.includes('def ') && lowerContent.includes('import')) {
    return 'Python';
  } else if (lowerContent.includes('public class')) {
    return 'Java';
  }

  return null;
}

// ==================== 统一文件处理接口 ====================

/**
 * 统一的文件处理接口，支持图片、PDF、JSON、TXT等多种格式
 * @param {File} file 文件对象
 * @param {Object} options 处理选项
 * @returns {Promise<Object>} 处理结果
 */
window.__processAnyFile = async function (file, options = {}) {
  try {
    if (!file) {
      throw new Error('请提供文件');
    }

    const detection = FileTypeDetector.detectFileType(file);

    if (pluginConfig.enableLogging) {
      console.log('[Unified File Processor] 处理文件:', {
        name: file.name,
        type: file.type,
        size: file.size,
        detection: detection,
      });
    }

    let result = {
      success: false,
      type: detection.type,
      fileName: file.name,
      fileSize: file.size,
      timestamp: new Date().toISOString(),
    };

    // 根据文件类型选择处理方式
    if (detection.isImage) {
      // 图片处理
      const imageResult = await ImageProcessor.processImage(file);
      result = {
        ...result,
        success: true,
        contentType: 'image',
        url: imageResult.url,
        metadata: imageResult.metadata,
      };
    } else if (detection.isDocument) {
      // 文档处理
      let content = '';

      if (detection.fileExtension === 'pdf') {
        // PDF文件
        content = await window.__extractTextFromPDF(file);
        result.contentType = 'pdf';
      } else if (detection.fileExtension === 'json') {
        // JSON文件
        const jsonData = await window.__parseJsonFile(file);
        content = JSON.stringify(jsonData, null, 2);
        result.contentType = 'json';
        result.jsonData = jsonData;
      } else {
        // 文本文件
        content = await window.__readTextFile(file);
        result.contentType = 'text';
      }

      result = {
        ...result,
        success: true,
        content: content,
        contentLength: content.length,
      };

      // 如果需要发送到聊天
      if (options.sendToChat !== false) {
        await sendFileContentToChat(content, file.name, detection.fileExtension);
      }
    } else {
      throw new Error(`不支持的文件类型: ${detection.fileType || '未知'} (${file.name})`);
    }

    return result;
  } catch (error) {
    console.error('[Unified File Processor] 处理失败:', error);
    return {
      success: false,
      error: error.message,
      fileName: file.name,
      timestamp: new Date().toISOString(),
    };
  }
};

/**
 * 发送文件内容到聊天（适配同层私聊）
 * @param {string} content 文件内容
 * @param {string} fileName 文件名
 * @param {string} fileType 文件类型
 */
async function sendFileContentToChat(content, fileName, fileType) {
  try {
    // 文档类型图标
    const typeIcons = {
      json: '📋',
      txt: '📄',
      md: '📝',
      html: '🌐',
      xml: '📄',
      csv: '📊',
      js: '⚡',
      css: '🎨',
      yaml: '⚙️',
      yml: '⚙️',
      log: '📜',
      pdf: '📕',
    };

    const icon = typeIcons[fileType] || '📄';

    // 限制显示长度
    const maxLength = 2000;
    const displayContent =
      content.length > maxLength ? content.substring(0, maxLength) + '\n\n...(内容已截断，完整内容已保存)' : content;

    // 生成消息内容
    const messageContent = `${icon} **文档内容** (${fileName})\n\n\`\`\`${fileType}\n${displayContent}\n\`\`\``;

    // 尝试发送到不同的聊天环境
    const chatEnvironments = [
      // SillyTavern环境
      () => {
        if (typeof window.addOneMessage === 'function') {
          return window.addOneMessage({
            name: 'User',
            is_user: true,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: messageContent,
            extra: {
              type: 'document_upload',
              file_name: fileName,
              document_type: fileType,
              processed_by: 'smart_media_assistant',
            },
          });
        }
        return null;
      },
      // 同层私聊环境
      () => {
        if (typeof window.addMessage === 'function') {
          const currentTime = new Date().toTimeString().slice(0, 5);
          const fileMessage = `[我方消息|文档|${fileName}|${fileType}|${content}|${currentTime}]`;
          return window.addMessage(fileMessage);
        }
        return null;
      },
      // 父窗口环境
      () => {
        if (typeof parent.addMessage === 'function') {
          const currentTime = new Date().toTimeString().slice(0, 5);
          const fileMessage = `[我方消息|文档|${fileName}|${fileType}|${content}|${currentTime}]`;
          return parent.addMessage(fileMessage);
        }
        return null;
      },
    ];

    // 尝试发送到可用的聊天环境
    for (const envFunc of chatEnvironments) {
      try {
        const result = envFunc();
        if (result) {
          if (pluginConfig.enableLogging) {
            console.log('[File Processor] 文档已发送到聊天环境');
          }
          return;
        }
      } catch (error) {
        console.warn('[File Processor] 聊天环境发送失败:', error);
        continue;
      }
    }

    console.warn('[File Processor] 无法找到可用的聊天环境');
  } catch (error) {
    console.error('[File Processor] 发送文档失败:', error);
  }
}

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
  // CSS文件已经通过manifest.json加载，这里只添加动态样式
  const styleId = 'smart-media-assistant-dynamic-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* 动态样式补充 */
    .smart-media-assistant .setting-group {
      margin-bottom: 15px;
      padding: 12px;
      border: 1px solid #444;
      border-radius: 3px;
      background: #333;
    }

    .smart-media-assistant .setting-group h4 {
      margin: 0 0 10px 0;
      color: #ccc;
      font-size: 13px;
      font-weight: normal;
      border-bottom: 1px solid #444;
      padding-bottom: 6px;
    }

    .smart-media-assistant label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      cursor: pointer;
      color: #bbb;
      font-size: 12px;
    }

    .smart-media-assistant input[type="checkbox"] {
      margin: 0;
      accent-color: #666;
    }

    .smart-media-assistant input[type="range"] {
      width: 100%;
      margin: 4px 0;
      accent-color: #666;
    }

    .smart-media-assistant .setting-description {
      font-size: 10px;
      color: #888;
      margin-top: 3px;
      margin-left: 20px;
      line-height: 1.2;
      font-style: italic;
    }
  `;

  document.head.appendChild(style);
}

/**
 * 创建设置界面HTML
 */
function createSettingsHTML() {
  return `
    <div class="smart-media-assistant">
      <details class="smart-media-collapsible" open>
        <summary class="smart-media-header">
          <span class="smart-media-icon">🎯</span>
          <span class="smart-media-title">智能媒体助手</span>
          <span class="smart-media-version">v1.0.0</span>
          <span class="smart-media-collapse-indicator">▼</span>
        </summary>
        <div class="smart-media-content">
          <div class="setting-group">
            <h4>🔧 基础设置</h4>
            <label>
              <input type="checkbox" id="${MODULE_NAME}_enableImageProcessing" ${
    pluginConfig.enableImageProcessing ? 'checked' : ''
  }>
              启用图片处理
            </label>
            <div class="setting-description">开启图片压缩、优化和AI识图功能</div>

            <label>
              <input type="checkbox" id="${MODULE_NAME}_enableDocumentProcessing" ${
    pluginConfig.enableDocumentProcessing ? 'checked' : ''
  }>
              启用文档处理
            </label>
            <div class="setting-description">开启txt、json等文档文件的处理功能</div>
          </div>

          <div class="setting-group">
            <h4>🖼️ 图片设置</h4>
            <label>
              图片质量: <span id="${MODULE_NAME}_imageQualityValue">${pluginConfig.imageQuality}</span>%
              <input type="range" id="${MODULE_NAME}_imageQuality" min="10" max="100" step="5" value="${
    pluginConfig.imageQuality
  }">
            </label>
            <div class="setting-description">图片压缩质量，数值越高质量越好但文件越大</div>

            <label>
              图片最大尺寸: <span id="${MODULE_NAME}_maxImageDimensionValue">${pluginConfig.maxImageDimension}</span>px
              <input type="range" id="${MODULE_NAME}_maxImageDimension" min="512" max="4096" step="128" value="${
    pluginConfig.maxImageDimension
  }">
            </label>
            <div class="setting-description">图片的最大宽度或高度（像素）</div>
          </div>

          <div class="setting-group">
            <h4>📄 文档设置</h4>
            <label>
              <input type="checkbox" id="${MODULE_NAME}_enableAIReading" ${
    pluginConfig.enableAIReading ? 'checked' : ''
  }>
              启用AI文档阅读
            </label>
            <div class="setting-description">自动使用AI分析上传的文档内容</div>

            <label>
              文件大小限制: <span id="${MODULE_NAME}_maxFileSizeValue">${pluginConfig.maxFileSize}</span>MB
              <input type="range" id="${MODULE_NAME}_maxFileSize" min="1" max="100" step="1" value="${
    pluginConfig.maxFileSize
  }">
            </label>
            <div class="setting-description">允许处理的最大文件大小</div>
          </div>

          <div class="setting-group">
            <h4>⚙️ 高级设置</h4>
            <label>
              <input type="checkbox" id="${MODULE_NAME}_showProcessingInfo" ${
    pluginConfig.showProcessingInfo ? 'checked' : ''
  }>
              显示处理信息
            </label>
            <div class="setting-description">显示文件处理的详细信息和进度</div>

            <label>
              <input type="checkbox" id="${MODULE_NAME}_enableLogging" ${pluginConfig.enableLogging ? 'checked' : ''}>
              启用调试日志
            </label>
            <div class="setting-description">在控制台输出详细的调试信息</div>
          </div>
        </div>
      </details>
    </div>
  `;
}

/**
 * 绑定收缩栏事件
 */
function bindCollapsibleEvents() {
  const STORAGE_KEY = 'smart-media-assistant-collapsed';

  // 保存收缩状态
  const saveCollapsedState = isOpen => {
    localStorage.setItem(STORAGE_KEY, !isOpen);
  };

  // 加载收缩状态
  const loadCollapsedState = () => {
    const collapsed = localStorage.getItem(STORAGE_KEY);
    return collapsed === 'true';
  };

  // 应用保存的收缩状态
  const details = $('.smart-media-collapsible')[0];
  if (details && loadCollapsedState()) {
    details.removeAttribute('open');
  }

  // 监听收缩状态变化
  $('.smart-media-collapsible').on('toggle', function () {
    const isOpen = this.hasAttribute('open');
    saveCollapsedState(isOpen);

    // 添加动画效果
    const indicator = $(this).find('.smart-media-collapse-indicator');
    if (isOpen) {
      indicator.css('transform', 'rotate(180deg)');
    } else {
      indicator.css('transform', 'rotate(0deg)');
    }

    if (pluginConfig.enableLogging) {
      console.log(`[Smart Media Assistant] 设置面板${isOpen ? '展开' : '收缩'}`);
    }
  });

  // 添加点击动画效果
  $('.smart-media-header')
    .on('mousedown', function () {
      $(this).css('transform', 'translateY(0px)');
    })
    .on('mouseup mouseleave', function () {
      $(this).css('transform', 'translateY(-1px)');
    });

  if (pluginConfig.enableLogging) {
    console.log('[Smart Media Assistant] 收缩栏功能已启用');
  }
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
  const context = getContext();
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
export { DocumentProcessor, FileProcessor, FileTypeDetector, FileValidator, ImageProcessor };
