/**
 * 意图识别工具函数
 * 提供文本相似度计算、关键词提取、槽位提取等功能
 */

/**
 * 计算两个字符串的相似度（基于编辑距离）
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @returns 相似度分数 (0-1)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const len1 = str1.length;
  const len2 = str2.length;

  // 使用 Levenshtein 距离
  const matrix: number[][] = [];

  // 初始化矩阵
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // 填充矩阵
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 删除
        matrix[i][j - 1] + 1,      // 插入
        matrix[i - 1][j - 1] + cost // 替换
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);

  return 1 - distance / maxLen;
}

/**
 * 计算两个字符串的 Jaccard 相似度（基于词集）
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @returns Jaccard 相似度 (0-1)
 */
export function jaccardSimilarity(str1: string, str2: string): number {
  const set1 = new Set(str1.split(/\s+/));
  const set2 = new Set(str2.split(/\s+/));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * 计算两个字符串的余弦相似度（基于词频）
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @returns 余弦相似度 (0-1)
 */
export function cosineSimilarity(str1: string, str2: string): number {
  const words1 = str1.split(/\s+/);
  const words2 = str2.split(/\s+/);

  const freq1 = getWordFrequency(words1);
  const freq2 = getWordFrequency(words2);

  const allWords = new Set([...Object.keys(freq1), ...Object.keys(freq2)]);

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (const word of allWords) {
    const v1 = freq1[word] || 0;
    const v2 = freq2[word] || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  if (norm1 === 0 || norm2 === 0) return 0;

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 获取词频统计
 */
function getWordFrequency(words: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  return freq;
}

// 停用词列表（中文和英文）
const STOP_WORDS = new Set([
  // 中文停用词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个',
  // 英文停用词
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
]);

/**
 * 提取关键词
 * @param text 输入文本
 * @param maxKeywords 最大关键词数量
 * @returns 关键词列表
 */
export function extractKeywords(text: string, maxKeywords: number = 10): string[] {
  // 清理文本
  const cleaned = text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')  // 保留中文、英文、数字
    .replace(/\s+/g, ' ')
    .trim();

  // 分词
  const words: string[] = [];
  
  // 简单的中文分词（基于字符）
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    // 如果是中文字符，作为独立词
    if (/[\u4e00-\u9fa5]/.test(char)) {
      words.push(char);
      // 也尝试提取双字词
      if (i + 1 < cleaned.length) {
        const nextChar = cleaned[i + 1];
        if (/[\u4e00-\u9fa5]/.test(nextChar)) {
          words.push(char + nextChar);
        }
      }
    } else if (/[a-z0-9]+/.test(char)) {
      // 英文单词或数字
      let word = char;
      while (i + 1 < cleaned.length && /[a-z0-9]/.test(cleaned[i + 1])) {
        word += cleaned[++i];
      }
      words.push(word);
    }
  }

  // 过滤停用词和短词
  const filtered = words.filter(word => 
    word.length >= 2 && !STOP_WORDS.has(word)
  );

  // 统计词频
  const freq: Record<string, number> = {};
  for (const word of filtered) {
    freq[word] = (freq[word] || 0) + 1;
  }

  // 按词频排序并返回前 N 个
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

/**
 * 从文本中提取命名实体
 * @param text 输入文本
 * @param entityType 实体类型 ('email' | 'url' | 'phone' | 'date' | 'number' | 'code')
 * @returns 提取的实体列表
 */
export function extractEntities(text: string, entityType: string): string[] {
  const patterns: Record<string, RegExp> = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
    phone: /(\+?86)?1[3-9]\d{9}/g,
    date: /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)|(\d{1,2}[-/月]\d{1,2}[日]?)/g,
    number: /\d+(\.\d+)?/g,
    code: /`[^`]+`|```[\s\S]*?```/g,
  };

  const pattern = patterns[entityType];
  if (!pattern) return [];

  const matches = text.match(pattern);
  return matches || [];
}

/**
 * 提取槽位
 * @param text 输入文本
 * @param slotType 槽位类型
 * @param pattern 自定义正则模式（可选）
 * @returns 提取的槽位值
 */
export function extractSlots(
  text: string,
  slotType: string,
  pattern?: string
): string | null {
  // 如果提供了自定义模式，优先使用
  if (pattern) {
    const customRegex = new RegExp(pattern, 'i');
    const match = text.match(customRegex);
    if (match) {
      return match[1] || match[0];
    }
  }

  // 内置槽位类型模式
  const slotPatterns: Record<string, RegExp[]> = {
    location: [
      /(?:在|去|到|从|位于)?\s*([\u4e00-\u9fa5]{2,}(?:市|省|区|县|镇|乡|村|街|路|号))/,
      /([\u4e00-\u9fa5]{2,}(?:市|省|区|县))/,
    ],
    time: [
      /(明天|今天|昨天|后天|下周|上周|下个月|上个月)/,
      /(\d{1,2}[:点]\d{0,2})/,
      /(\d{1,2}分钟?前|(\d{1,2})小时前)/,
    ],
    date: [
      /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/,
      /(明天|今天|昨天|后天|大后天)/,
    ],
    person: [
      /([\u4e00-\u9fa5]{2,4})(?:先生|女士|老师|医生|教授)/,
      /(?:叫|名为|是)\s*([\u4e00-\u9fa5]{2,4})/,
    ],
    number: [
      /(\d+(?:\.\d+)?)\s*(?:个|条|张|本|次|天|小时|分钟|秒)/,
      /(?:数量|数目|几个|多少)\s*(?:是)?\s*(\d+)/,
    ],
    language: [
      /(中文|英文|英语|日语|韩语|法语|德语|西班牙语|俄语|Python|Java|JavaScript|TypeScript|C\+\+|Go|Rust)/i,
    ],
    query: [
      /(?:查|找|搜索)(?:什么|啥|哪个|哪些)?\s*["']?([^"']{2,20})["']?/,
      /(?:关于|有关)\s*["']?([^"']{2,20})["']?/,
    ],
    topic: [
      /(?:主题|话题|题目|标题)[:是为]\s*["']?([^"']{2,30})["']?/,
    ],
    filename: [
      /([\w\-./]+\.(?:js|ts|py|java|go|rs|cpp|c|h|json|yaml|yml|md|txt|csv|html|css|sql))/i,
      /[`"']([\w\-./]+)[`"']/,
    ],
    code_snippet: [
      /```(\w+)?\n([\s\S]*?)```/,
      /`([^`]+)`/,
    ],
  };

  const patterns = slotPatterns[slotType];
  if (!patterns) {
    // 如果没有特定模式，尝试提取引号内的内容
    const quoted = text.match(/["']([^"']+)["']/);
    return quoted ? quoted[1] : null;
  }

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) {
      // 返回第一个捕获组或完整匹配
      return match[1] || match[0];
    }
  }

  return null;
}

/**
 * 文本预处理
 * @param text 原始文本
 * @returns 处理后的文本
 */
export function preprocessText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')           // 规范化空格
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ') // 保留中文、英文、数字
    .trim();
}

/**
 * 计算文本的向量表示（简化版词袋模型）
 * @param text 输入文本
 * @param vocabulary 词汇表
 * @returns 向量表示
 */
export function textToVector(text: string, vocabulary: string[]): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const wordSet = new Set(words);
  
  return vocabulary.map(word => wordSet.has(word) ? 1 : 0);
}

/**
 * 模糊匹配字符串
 * @param text 文本
 * @param candidates 候选列表
 * @param threshold 相似度阈值
 * @returns 最佳匹配项
 */
export function fuzzyMatch(
  text: string,
  candidates: string[],
  threshold: number = 0.6
): { match: string; score: number } | null {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = calculateSimilarity(text.toLowerCase(), candidate.toLowerCase());
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestMatch ? { match: bestMatch, score: bestScore } : null;
}

/**
 * 检测文本语言
 * @param text 输入文本
 * @returns 语言代码 ('zh' | 'en' | 'mixed' | 'unknown')
 */
export function detectLanguage(text: string): string {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;

  if (totalChars === 0) return 'unknown';

  const chineseRatio = chineseChars / totalChars;
  const englishRatio = englishChars / totalChars;

  if (chineseRatio > 0.5) return 'zh';
  if (englishRatio > 0.5) return 'en';
  if (chineseRatio > 0.2 && englishRatio > 0.2) return 'mixed';
  return 'unknown';
}

/**
 * 分割句子
 * @param text 输入文本
 * @returns 句子列表
 */
export function splitSentences(text: string): string[] {
  // 中文和英文的句子分隔符
  const sentences = text
    .replace(/([。！？；.!?;])(?=[^\s])/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return sentences;
}

/**
 * 计算文本复杂度
 * @param text 输入文本
 * @returns 复杂度分数 (0-1)
 */
export function calculateComplexity(text: string): number {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  if (sentences.length === 0 || words.length === 0) return 0;

  const avgSentenceLength = words.length / sentences.length;
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const vocabularyRichness = uniqueWords.size / words.length;

  // 归一化复杂度分数
  const lengthScore = Math.min(avgSentenceLength / 20, 1);
  const richnessScore = vocabularyRichness;

  return (lengthScore * 0.5 + richnessScore * 0.5);
}
