/**
 * API 调试日志模块
 * 
 * 用于记录完整的 API 请求和响应，方便调试 token 计数等问题
 * 
 * 使用方法：
 *   1. 设置环境变量 DEBUG_API_LOG=true 启用
 *   2. 日志文件保存在 .debug/api-logs/ 目录
 *   3. 文件名格式: YYYY-MM-DD_HH-mm-ss-SSS.json
 * 
 * 注意：项目完成后可以删除此模块
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type OpenAI from 'openai';

interface APILogEntry {
  timestamp: string;
  request: {
    model: string;
    messages: any[]; // 改为 any[] 以支持不同的 API
    tools?: any[];
    maxTokens?: number;
    system?: string; // Claude 的 system 参数
  };
  response: {
    content: string;
    toolCalls: any[];
    usage: {
      prompt: number;
      completion: number;
      total: number;
    };
    finishReason: string;
    rawResponse?: any; // 原始响应对象（可选）
  };
  analysis: {
    messageCount: number;
    totalPromptLength: number;
    responseLength: number;
    tokensPerChar: number;
  };
}

class APILogger {
  private enabled: boolean;
  private logDir: string;

  constructor() {
    // 通过环境变量控制是否启用
    this.enabled = process.env.DEBUG_API_LOG === 'true';
    this.logDir = join(process.cwd(), '.debug', 'api-logs');
  }

  /**
   * 是否启用日志
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 记录一次 API 调用
   */
  async log(
    request: {
      model: string;
      messages?: any[]; // OpenAI 使用
      system?: string; // Claude 使用
      tools?: any[];
      maxTokens?: number;
    },
    response: {
      content: string;
      toolCalls: any[];
      usage: { prompt: number; completion: number; total: number };
      finishReason: string;
      rawResponse?: any;
    }
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      // 确保目录存在
      await mkdir(this.logDir, { recursive: true });

      // 生成文件名：YYYY-MM-DD_HH-mm-ss-SSS.json
      const now = new Date();
      const filename = this.formatTimestamp(now) + '.json';
      const filepath = join(this.logDir, filename);

      // 计算统计信息
      const totalPromptLength = this.calculatePromptLength(request.messages || [], request.system);
      const responseLength = response.content.length;
      const tokensPerChar = responseLength > 0 
        ? response.usage.completion / responseLength 
        : 0;

      // 构建日志条目
      const logEntry: APILogEntry = {
        timestamp: now.toISOString(),
        request: {
          model: request.model,
          messages: request.messages || [],
          system: request.system,
          tools: request.tools,
          maxTokens: request.maxTokens,
        },
        response: {
          content: response.content,
          toolCalls: response.toolCalls,
          usage: response.usage,
          finishReason: response.finishReason,
          rawResponse: response.rawResponse,
        },
        analysis: {
          messageCount: (request.messages || []).length,
          totalPromptLength,
          responseLength,
          tokensPerChar: parseFloat(tokensPerChar.toFixed(2)),
        },
      };

      // 写入文件
      await writeFile(filepath, JSON.stringify(logEntry, null, 2), 'utf-8');

      console.log(`[API Logger] 日志已保存: ${filename}`);
    } catch (error) {
      console.error('[API Logger] 保存日志失败:', error);
    }
  }

  /**
   * 格式化时间戳为文件名
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}-${ms}`;
  }

  /**
   * 计算 prompt 的总字符长度
   */
  private calculatePromptLength(messages: any[], system?: string): number {
    let total = 0;
    
    // 计算 system prompt 长度
    if (system) {
      total += system.length;
    }
    
    // 计算 messages 长度
    for (const msg of messages) {
      if ('content' in msg) {
        if (typeof msg.content === 'string') {
          total += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          // Claude 的 content 可能是数组
          for (const block of msg.content) {
            if (typeof block === 'object' && 'text' in block) {
              total += String(block.text).length;
            }
          }
        }
      }
    }
    return total;
  }
}

// 全局单例
export const apiLogger = new APILogger();
