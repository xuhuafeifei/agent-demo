/**
 * 文件类型检测模块
 * 用于 read 工具的文本文件门控
 * 策略：
 * 1. 扩展名在 BINARY_EXTENSIONS → 拒绝读
 * 2. 扩展名在 TEXT_EXTENSIONS → 允许读
 * 3. 无扩展名或未知：读取文件头 sniff；疑似二进制则拒绝；无法判断时倾向拒绝
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TEXT_EXTENSIONS, BINARY_EXTENSIONS } from './constants.js';

/** 二进制文件魔数（文件头标识） */
const BINARY_MAGIC_NUMBERS: number[][] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff],       // JPEG
  [0x47, 0x49, 0x46],       // GIF
  [0x42, 0x4d],             // BMP
  [0x50, 0x4b, 0x03, 0x04], // ZIP (also covers .docx, .xlsx, .jar, etc.)
  [0x1f, 0x8b],             // GZIP
  [0x42, 0x5a, 0x68],       // BZIP2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // XZ
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Java class (also Mach-O fat)
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O (64-bit)
  [0x25, 0x50, 0x44, 0x46], // PDF (%PDF)
  [0xd0, 0xcf, 0x11, 0xe0], // MS Office (old format)
];

/**
 * 读取文件头用于魔数检测
 */
async function readFileHeader(filePath: string, size: number): Promise<Buffer> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await fileHandle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

/**
 * 检查缓冲区是否匹配二进制魔数
 */
function isBinaryMagicNumber(buffer: Buffer): boolean {
  for (const magic of BINARY_MAGIC_NUMBERS) {
    if (buffer.length < magic.length) continue;
    const matches = magic.every((byte, i) => buffer[i] === byte);
    if (matches) return true;
  }
  return false;
}

/**
 * 检查缓冲区是否包含大量空字节（二进制文件特征）
 */
function hasHighNullByteRatio(buffer: Buffer): boolean {
  let nullCount = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) nullCount++;
  }
  const ratio = nullCount / buffer.length;
  return ratio > 0.1; // 超过 10% 的空字节认为是二进制
}

/**
 * 判定文件是否为文本文件
 * 
 * @param filePath 文件路径
 * @returns true 如果是文本文件，false 如果是二进制或未知
 */
export async function isTextFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  
  // 1. 扩展名在 BINARY_EXTENSIONS → 拒绝
  if (BINARY_EXTENSIONS.has(ext)) {
    return false;
  }
  
  // 2. 扩展名在 TEXT_EXTENSIONS → 允许
  if (TEXT_EXTENSIONS.has(ext)) {
    return true;
  }
  
  // 3. 无扩展名或未知：读取文件头 sniff
  try {
    const buffer = await readFileHeader(filePath, 512);
    
    // 空文件视为文本
    if (buffer.length === 0) {
      return true;
    }
    
    // 魔数检测
    if (isBinaryMagicNumber(buffer)) {
      return false;
    }
    
    // 空字节比例检测
    if (hasHighNullByteRatio(buffer)) {
      return false;
    }
    
    // UTF-8 有效性检测（尝试解码）
    try {
      buffer.toString('utf8');
      // 能解码但还需要检查是否包含控制字符
      const hasControlChars = buffer.some(byte => 
        byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d
      );
      return !hasControlChars;
    } catch {
      return false; // 无法解码为 UTF-8
    }
  } catch {
    // 读取失败：倾向拒绝
    return false;
  }
}

/**
 * 获取文件类型的拒绝原因
 */
export function getFileTypeRejectReason(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  if (BINARY_EXTENSIONS.has(ext)) {
    return '不支持读取二进制文件';
  }
  
  return '文件类型未知，为安全起见拒绝读取';
}
