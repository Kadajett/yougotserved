/**
 * Vector database manager
 * Uses hnswlib-wasm for high-performance vector similarity search
 * Implements singleton pattern to avoid duplicate WASM module initialization
 */

import { loadHnswlib } from 'hnswlib-wasm-static';
import type { TextChunk } from './text-chunker';

export interface VectorDocument {
  id: string;
  tabId: number;
  url: string;
  title: string;
  chunk: TextChunk;
  embedding: Float32Array;
  timestamp: number;
}

export interface SearchResult {
  document: VectorDocument;
  similarity: number;
  distance: number;
}

export interface VectorDatabaseConfig {
  dimension: number;
  maxElements: number;
  efConstruction: number;
  M: number;
  efSearch: number;
  indexFileName: string;
  enableAutoCleanup?: boolean;
  maxRetentionDays?: number;
}

let globalHnswlib: any = null;
let globalHnswlibInitPromise: Promise<any> | null = null;
let globalHnswlibInitialized = false;

let syncInProgress = false;
let pendingSyncPromise: Promise<void> | null = null;

const DB_NAME = 'VectorDatabaseStorage';
const DB_VERSION = 1;
const STORE_NAME = 'documentMappings';

/**
 * IndexedDB helper functions
 */
class IndexedDBHelper {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  static async getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;


          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('indexFileName', 'indexFileName', { unique: false });
          }
        };
      });
    }
    return this.dbPromise;
  }

  static async saveData(indexFileName: string, data: any): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        id: indexFileName,
        indexFileName,
        data,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async loadData(indexFileName: string): Promise<any | null> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise<any | null>((resolve, reject) => {
      const request = store.get(indexFileName);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async deleteData(indexFileName: string): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(indexFileName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all IndexedDB data (for complete cleanup during model switching)
   */
  static async clearAllData(): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
          console.log('IndexedDBHelper: All data cleared from IndexedDB');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('IndexedDBHelper: Failed to clear all data:', error);
      throw error;
    }
  }

  /**
   * Get all stored keys (for debugging)
   */
  static async getAllKeys(): Promise<string[]> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise<string[]>((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('IndexedDBHelper: Failed to get all keys:', error);
      return [];
    }
  }
}

/**
 * Global hnswlib-wasm initialization function
 * Ensures initialization only once across the entire application
 */
async function initializeGlobalHnswlib(): Promise<any> {
  if (globalHnswlibInitialized && globalHnswlib) {
    return globalHnswlib;
  }

  if (globalHnswlibInitPromise) {
    return globalHnswlibInitPromise;
  }

  globalHnswlibInitPromise = (async () => {
    try {
      console.log('VectorDatabase: Initializing global hnswlib-wasm instance...');
      globalHnswlib = await loadHnswlib();
      globalHnswlibInitialized = true;
      console.log('VectorDatabase: Global hnswlib-wasm instance initialized successfully');
      return globalHnswlib;
    } catch (error) {
      console.error('VectorDatabase: Failed to initialize global hnswlib-wasm:', error);
      globalHnswlibInitPromise = null;
      throw error;
    }
  })();

  return globalHnswlibInitPromise;
}

export class VectorDatabase {
  private index: any = null;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private documents = new Map<number, VectorDocument>();
  private tabDocuments = new Map<number, Set<number>>();
  private nextLabel = 0;

  private readonly config: VectorDatabaseConfig;

  constructor(config?: Partial<VectorDatabaseConfig>) {
    this.config = {
      dimension: 384,
      maxElements: 100000,
      efConstruction: 200,
      M: 48,
      efSearch: 50,
      indexFileName: 'tab_content_index.dat',
      enableAutoCleanup: true,
      maxRetentionDays: 30,
      ...config,
    };

    console.log('VectorDatabase: Initialized with config:', {
      dimension: this.config.dimension,
      efSearch: this.config.efSearch,
      M: this.config.M,
      efConstruction: this.config.efConstruction,
      enableAutoCleanup: this.config.enableAutoCleanup,
      maxRetentionDays: this.config.maxRetentionDays,
    });
  }

  /**
   * Initialize vector database
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing && this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this._doInitialize().finally(() => {
      this.isInitializing = false;
    });

    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('VectorDatabase: Initializing...');

      const hnswlib = await initializeGlobalHnswlib();

      hnswlib.EmscriptenFileSystemManager.setDebugLogs(true);

      this.index = new hnswlib.HierarchicalNSW(
        'cosine',
        this.config.dimension,
        this.config.indexFileName,
      );

      await this.syncFileSystem('read');


      const indexExists = hnswlib.EmscriptenFileSystemManager.checkFileExists(
        this.config.indexFileName,
      );

      if (indexExists) {
        console.log('VectorDatabase: Loading existing index...');
        try {
          await this.index.readIndex(this.config.indexFileName, this.config.maxElements);
          this.index.setEfSearch(this.config.efSearch);

          await this.loadDocumentMappings();

          if (this.documents.size > 0) {
            const maxLabel = Math.max(...Array.from(this.documents.keys()));
            this.nextLabel = maxLabel + 1;
            console.log(
              `VectorDatabase: Loaded existing index with ${this.documents.size} documents, next label: ${this.nextLabel}`,
            );
          } else {
            const indexCount = this.index.getCurrentCount();
            if (indexCount > 0) {
              console.warn(
                `VectorDatabase: Index has ${indexCount} vectors but no document mappings found. This may cause label mismatch.`,
              );
              this.nextLabel = indexCount;
            } else {
              this.nextLabel = 0;
            }
            console.log(
              `VectorDatabase: No document mappings found, starting with next label: ${this.nextLabel}`,
            );
          }
        } catch (loadError) {
          console.warn(
            'VectorDatabase: Failed to load existing index, creating new one:',
            loadError,
          );

          this.index.initIndex(
            this.config.maxElements,
            this.config.M,
            this.config.efConstruction,
            200,
          );
          this.index.setEfSearch(this.config.efSearch);
          this.nextLabel = 0;
        }
      } else {
        console.log('VectorDatabase: Creating new index...');
        this.index.initIndex(
          this.config.maxElements,
          this.config.M,
          this.config.efConstruction,
          200,
        );
        this.index.setEfSearch(this.config.efSearch);
        this.nextLabel = 0;
      }

      this.isInitialized = true;
      console.log('VectorDatabase: Initialization completed successfully');
    } catch (error) {
      console.error('VectorDatabase: Initialization failed:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Add document to vector database
   */
  public async addDocument(
    tabId: number,
    url: string,
    title: string,
    chunk: TextChunk,
    embedding: Float32Array,
  ): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const documentId = this.generateDocumentId(tabId, chunk.index);
    const document: VectorDocument = {
      id: documentId,
      tabId,
      url,
      title,
      chunk,
      embedding,
      timestamp: Date.now(),
    };

    try {
      // 验证向量数据
      if (!embedding || embedding.length !== this.config.dimension) {
        const errorMsg = `Invalid embedding dimension: expected ${this.config.dimension}, got ${embedding?.length || 0}`;
        console.error('VectorDatabase: Dimension mismatch detected!', {
          expectedDimension: this.config.dimension,
          actualDimension: embedding?.length || 0,
          documentId,
          tabId,
          url,
          title: title.substring(0, 50) + '...',
        });

        // 这可能是模型切换导致的维度不匹配，建议重新初始化
        console.warn(
          'VectorDatabase: This might be caused by model switching. Consider reinitializing the vector database with the correct dimension.',
        );

        throw new Error(errorMsg);
      }

      // 检查向量数据是否包含无效值
      for (let i = 0; i < embedding.length; i++) {
        if (!isFinite(embedding[i])) {
          throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
        }
      }

      // 确保我们有一个干净的 Float32Array
      let cleanEmbedding: Float32Array;
      if (embedding instanceof Float32Array) {
        cleanEmbedding = embedding;
      } else {
        cleanEmbedding = new Float32Array(embedding);
      }

      // 使用当前的nextLabel作为label
      const label = this.nextLabel++;

      console.log(
        `VectorDatabase: Adding document with label ${label}, embedding dimension: ${embedding.length}`,
      );

      // 添加向量到索引
      // 根据 hnswlib-wasm-static 的 emscripten 绑定要求，需要创建 VectorFloat 类型
      console.log(`VectorDatabase: 🔧 DEBUGGING - About to call addPoint with:`, {
        embeddingType: typeof cleanEmbedding,
        isFloat32Array: cleanEmbedding instanceof Float32Array,
        length: cleanEmbedding.length,
        firstFewValues: Array.from(cleanEmbedding.slice(0, 3)),
        label: label,
        replaceDeleted: false,
      });

      // 方法1: 尝试使用 VectorFloat 构造函数（如果可用）
      let vectorToAdd;
      try {
        // 检查是否有 VectorFloat 构造函数
        if (globalHnswlib && globalHnswlib.VectorFloat) {
          console.log('VectorDatabase: Using VectorFloat constructor');
          vectorToAdd = new globalHnswlib.VectorFloat();
          // 逐个添加元素到 VectorFloat
          for (let i = 0; i < cleanEmbedding.length; i++) {
            vectorToAdd.push_back(cleanEmbedding[i]);
          }
        } else {
          // 方法2: 使用普通 JS 数组（回退方案）
          console.log('VectorDatabase: Using plain JS array as fallback');
          vectorToAdd = Array.from(cleanEmbedding);
        }

        // 使用构造的向量调用 addPoint
        this.index.addPoint(vectorToAdd, label, false);

        // 清理 VectorFloat 对象（如果是手动创建的）
        if (vectorToAdd && typeof vectorToAdd.delete === 'function') {
          vectorToAdd.delete();
        }
      } catch (vectorError) {
        console.error(
          'VectorDatabase: VectorFloat approach failed, trying alternatives:',
          vectorError,
        );

        // 方法3: 尝试直接传递 Float32Array
        try {
          console.log('VectorDatabase: Trying Float32Array directly');
          this.index.addPoint(cleanEmbedding, label, false);
        } catch (float32Error) {
          console.error('VectorDatabase: Float32Array approach failed:', float32Error);

          // 方法4: 最后的回退 - 使用扩展运算符
          console.log('VectorDatabase: Trying spread operator as last resort');
          this.index.addPoint([...cleanEmbedding], label, false);
        }
      }
      console.log(`VectorDatabase: ✅ Successfully added document with label ${label}`);

      // 存储文档映射
      this.documents.set(label, document);

      // 更新标签页文档映射
      if (!this.tabDocuments.has(tabId)) {
        this.tabDocuments.set(tabId, new Set());
      }
      this.tabDocuments.get(tabId)!.add(label);

      // 保存索引和映射
      await this.saveIndex();
      await this.saveDocumentMappings();

      // 检查是否需要自动清理
      if (this.config.enableAutoCleanup) {
        await this.checkAndPerformAutoCleanup();
      }

      console.log(`VectorDatabase: Successfully added document ${documentId} with label ${label}`);
      return label;
    } catch (error) {
      console.error('VectorDatabase: Failed to add document:', error);
      console.error('VectorDatabase: Embedding info:', {
        type: typeof embedding,
        constructor: embedding?.constructor?.name,
        length: embedding?.length,
        isFloat32Array: embedding instanceof Float32Array,
        firstFewValues: embedding ? Array.from(embedding.slice(0, 5)) : null,
      });
      throw error;
    }
  }

  /**
   * Search similar documents
   */
  public async search(queryEmbedding: Float32Array, topK: number = 10): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // 验证查询向量
      if (!queryEmbedding || queryEmbedding.length !== this.config.dimension) {
        throw new Error(
          `Invalid query embedding dimension: expected ${this.config.dimension}, got ${queryEmbedding?.length || 0}`,
        );
      }

      // 检查查询向量是否包含无效值
      for (let i = 0; i < queryEmbedding.length; i++) {
        if (!isFinite(queryEmbedding[i])) {
          throw new Error(`Invalid query embedding value at index ${i}: ${queryEmbedding[i]}`);
        }
      }

      console.log(
        `VectorDatabase: Searching with query embedding dimension: ${queryEmbedding.length}, topK: ${topK}`,
      );

      // 检查索引是否为空
      const currentCount = this.index.getCurrentCount();
      if (currentCount === 0) {
        console.log('VectorDatabase: Index is empty, returning no results');
        return [];
      }

      console.log(`VectorDatabase: Index contains ${currentCount} vectors`);

      // 检查文档映射与索引是否同步
      const mappingCount = this.documents.size;
      if (mappingCount === 0 && currentCount > 0) {
        console.warn(
          `VectorDatabase: Index has ${currentCount} vectors but document mapping is empty. Attempting to reload mappings...`,
        );
        await this.loadDocumentMappings();

        if (this.documents.size === 0) {
          console.error(
            'VectorDatabase: Failed to load document mappings. Index and mappings are out of sync.',
          );
          return [];
        }
        console.log(
          `VectorDatabase: Successfully reloaded ${this.documents.size} document mappings`,
        );
      }

      // 根据 hnswlib-wasm-static 的 emscripten 绑定要求，处理查询向量
      let queryVector;
      let searchResult;

      try {
        // 方法1: 尝试使用 VectorFloat 构造函数（如果可用）
        if (globalHnswlib && globalHnswlib.VectorFloat) {
          console.log('VectorDatabase: Using VectorFloat for search query');
          queryVector = new globalHnswlib.VectorFloat();
          // 逐个添加元素到 VectorFloat
          for (let i = 0; i < queryEmbedding.length; i++) {
            queryVector.push_back(queryEmbedding[i]);
          }
          searchResult = this.index.searchKnn(queryVector, topK, undefined);

          // 清理 VectorFloat 对象
          if (queryVector && typeof queryVector.delete === 'function') {
            queryVector.delete();
          }
        } else {
          // 方法2: 使用普通 JS 数组（回退方案）
          console.log('VectorDatabase: Using plain JS array for search query');
          const queryArray = Array.from(queryEmbedding);
          searchResult = this.index.searchKnn(queryArray, topK, undefined);
        }
      } catch (vectorError) {
        console.error(
          'VectorDatabase: VectorFloat search failed, trying alternatives:',
          vectorError,
        );

        // 方法3: 尝试直接传递 Float32Array
        try {
          console.log('VectorDatabase: Trying Float32Array directly for search');
          searchResult = this.index.searchKnn(queryEmbedding, topK, undefined);
        } catch (float32Error) {
          console.error('VectorDatabase: Float32Array search failed:', float32Error);

          // 方法4: 最后的回退 - 使用扩展运算符
          console.log('VectorDatabase: Trying spread operator for search as last resort');
          searchResult = this.index.searchKnn([...queryEmbedding], topK, undefined);
        }
      }

      const results: SearchResult[] = [];

      console.log(`VectorDatabase: Processing ${searchResult.neighbors.length} search neighbors`);
      console.log(`VectorDatabase: Available documents in mapping: ${this.documents.size}`);
      console.log(`VectorDatabase: Index current count: ${this.index.getCurrentCount()}`);

      for (let i = 0; i < searchResult.neighbors.length; i++) {
        const label = searchResult.neighbors[i];
        const distance = searchResult.distances[i];
        const similarity = 1 - distance; // 余弦距离转换为相似度

        console.log(
          `VectorDatabase: Processing neighbor ${i}: label=${label}, distance=${distance}, similarity=${similarity}`,
        );

        // 根据标签找到对应的文档
        const document = this.findDocumentByLabel(label);
        if (document) {
          console.log(`VectorDatabase: Found document for label ${label}: ${document.id}`);
          results.push({
            document,
            similarity,
            distance,
          });
        } else {
          console.warn(`VectorDatabase: No document found for label ${label}`);

          // 详细调试信息
          if (i < 5) {
            // 只为前5个邻居显示详细信息，避免日志过多
            console.warn(
              `VectorDatabase: Available labels (first 20): ${Array.from(this.documents.keys()).slice(0, 20).join(', ')}`,
            );
            console.warn(`VectorDatabase: Total available labels: ${this.documents.size}`);
            console.warn(
              `VectorDatabase: Label type: ${typeof label}, Available label types: ${Array.from(
                this.documents.keys(),
              )
                .slice(0, 3)
                .map((k) => typeof k)
                .join(', ')}`,
            );
          }
        }
      }

      console.log(
        `VectorDatabase: Found ${results.length} search results out of ${searchResult.neighbors.length} neighbors`,
      );

      // 如果没有找到任何结果，但索引中有数据，说明标签不匹配
      if (results.length === 0 && searchResult.neighbors.length > 0) {
        console.error(
          'VectorDatabase: Label mismatch detected! Index has vectors but no matching documents found.',
        );
        console.error(
          'VectorDatabase: This usually indicates the index and document mappings are out of sync.',
        );
        console.error('VectorDatabase: Consider rebuilding the index to fix this issue.');

        // 提供一些诊断信息
        const sampleLabels = searchResult.neighbors.slice(0, 5);
        const availableLabels = Array.from(this.documents.keys()).slice(0, 5);
        console.error('VectorDatabase: Sample search labels:', sampleLabels);
        console.error('VectorDatabase: Sample available labels:', availableLabels);
      }

      return results.sort((a, b) => b.similarity - a.similarity);
    } catch (error) {
      console.error('VectorDatabase: Search failed:', error);
      console.error('VectorDatabase: Query embedding info:', {
        type: typeof queryEmbedding,
        constructor: queryEmbedding?.constructor?.name,
        length: queryEmbedding?.length,
        isFloat32Array: queryEmbedding instanceof Float32Array,
        firstFewValues: queryEmbedding ? Array.from(queryEmbedding.slice(0, 5)) : null,
      });
      throw error;
    }
  }

  /**
   * Remove all documents for a tab
   */
  public async removeTabDocuments(tabId: number): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const documentLabels = this.tabDocuments.get(tabId);
    if (!documentLabels) {
      return;
    }

    try {
      // 从映射中删除文档（hnswlib-wasm不支持直接删除，只能标记删除）
      for (const label of documentLabels) {
        this.documents.delete(label);
      }

      // 清理标签页映射
      this.tabDocuments.delete(tabId);

      // 保存更改
      await this.saveDocumentMappings();

      console.log(`VectorDatabase: Removed ${documentLabels.size} documents for tab ${tabId}`);
    } catch (error) {
      console.error('VectorDatabase: Failed to remove tab documents:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  public getStats(): {
    totalDocuments: number;
    totalTabs: number;
    indexSize: number;
    isInitialized: boolean;
  } {
    return {
      totalDocuments: this.documents.size,
      totalTabs: this.tabDocuments.size,
      indexSize: this.calculateStorageSize(),
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Calculate actual storage size (bytes)
   */
  private calculateStorageSize(): number {
    let totalSize = 0;

    try {
      // 1. 计算文档映射的大小
      const documentsSize = this.calculateDocumentMappingsSize();
      totalSize += documentsSize;

      // 2. 计算向量数据的大小
      const vectorsSize = this.calculateVectorsSize();
      totalSize += vectorsSize;

      // 3. 估算索引结构的大小
      const indexStructureSize = this.calculateIndexStructureSize();
      totalSize += indexStructureSize;

      console.log(
        `VectorDatabase: Storage size breakdown - Documents: ${documentsSize}, Vectors: ${vectorsSize}, Index: ${indexStructureSize}, Total: ${totalSize} bytes`,
      );
    } catch (error) {
      console.warn('VectorDatabase: Failed to calculate storage size:', error);
      // 返回一个基于文档数量的估算值
      totalSize = this.documents.size * 1024; // 每个文档估算1KB
    }

    return totalSize;
  }

  /**
   * 计算文档映射的大小
   */
  private calculateDocumentMappingsSize(): number {
    let size = 0;

    // 计算documents Map的大小
    for (const [label, document] of this.documents.entries()) {
      // label (number): 8 bytes
      size += 8;

      // document object
      size += this.calculateObjectSize(document);
    }

    // 计算tabDocuments Map的大小
    for (const [tabId, labels] of this.tabDocuments.entries()) {
      // tabId (number): 8 bytes
      size += 8;

      // Set of labels: 8 bytes per label + Set overhead
      size += labels.size * 8 + 32; // 32 bytes Set overhead
    }

    return size;
  }

  /**
   * 计算向量数据的大小
   */
  private calculateVectorsSize(): number {
    const documentCount = this.documents.size;
    const dimension = this.config.dimension;

    // 每个向量: dimension * 4 bytes (Float32)
    const vectorSize = dimension * 4;

    return documentCount * vectorSize;
  }

  /**
   * 估算索引结构的大小
   */
  private calculateIndexStructureSize(): number {
    const documentCount = this.documents.size;

    if (documentCount === 0) return 0;

    // HNSW索引的大小估算
    // 基于论文和实际测试，HNSW索引大小约为向量数据的20-40%
    const vectorsSize = this.calculateVectorsSize();
    const indexOverhead = Math.floor(vectorsSize * 0.3); // 30%的开销

    // 额外的图结构开销
    const graphOverhead = documentCount * 64; // 每个节点约64字节的图结构开销

    return indexOverhead + graphOverhead;
  }

  /**
   * 计算对象的大小（粗略估算）
   */
  private calculateObjectSize(obj: any): number {
    let size = 0;

    try {
      const jsonString = JSON.stringify(obj);
      // UTF-8编码，大部分字符1字节，中文等3字节，平均按2字节计算
      size = jsonString.length * 2;
    } catch (error) {
      // 如果JSON序列化失败，使用默认估算
      size = 512; // 默认512字节
    }

    return size;
  }

  /**
   * Clear entire database
   */
  public async clear(): Promise<void> {
    console.log('VectorDatabase: Starting complete database clear...');

    try {
      // 清理内存中的数据结构
      this.documents.clear();
      this.tabDocuments.clear();
      this.nextLabel = 0;

      // 清理HNSW索引文件（在hnswlib-index数据库中）
      if (this.isInitialized && this.index) {
        try {
          console.log('VectorDatabase: Clearing HNSW index file from IndexedDB...');

          // 1. 首先尝试物理删除索引文件（使用EmscriptenFileSystemManager）
          try {
            if (
              globalHnswlib &&
              globalHnswlib.EmscriptenFileSystemManager.checkFileExists(this.config.indexFileName)
            ) {
              console.log(
                `VectorDatabase: Deleting physical index file: ${this.config.indexFileName}`,
              );
              globalHnswlib.EmscriptenFileSystemManager.deleteFile(this.config.indexFileName);
              await this.syncFileSystem('write'); // 确保删除操作同步到持久化存储
              console.log(
                `VectorDatabase: Physical index file ${this.config.indexFileName} deleted successfully`,
              );
            } else {
              console.log(
                `VectorDatabase: Physical index file ${this.config.indexFileName} does not exist or already deleted`,
              );
            }
          } catch (fileError) {
            console.warn(
              `VectorDatabase: Failed to delete physical index file ${this.config.indexFileName}:`,
              fileError,
            );
            // 继续执行其他清理操作，不阻塞流程
          }

          // 2. 删除IndexedDB中的索引文件
          await this.index.deleteIndex(this.config.indexFileName);
          console.log('VectorDatabase: HNSW index file cleared from IndexedDB');

          // 3. 重新初始化空索引
          console.log('VectorDatabase: Reinitializing empty HNSW index...');
          this.index.initIndex(
            this.config.maxElements,
            this.config.M,
            this.config.efConstruction,
            200,
          );
          this.index.setEfSearch(this.config.efSearch);

          // 4. 强制保存空索引
          await this.forceSaveIndex();
        } catch (indexError) {
          console.warn('VectorDatabase: Failed to clear HNSW index file:', indexError);
          // 继续执行其他清理操作
        }
      }

      // 清理IndexedDB中的文档映射（在VectorDatabaseStorage数据库中）
      try {
        console.log('VectorDatabase: Clearing document mappings from IndexedDB...');
        await IndexedDBHelper.deleteData(this.config.indexFileName);
        console.log('VectorDatabase: Document mappings cleared from IndexedDB');
      } catch (idbError) {
        console.warn(
          'VectorDatabase: Failed to clear document mappings from IndexedDB, trying chrome.storage fallback:',
          idbError,
        );

        // 清理chrome.storage中的备份数据
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          await chrome.storage.local.remove([storageKey]);
          console.log('VectorDatabase: Chrome storage fallback cleared');
        } catch (storageError) {
          console.warn('VectorDatabase: Failed to clear chrome.storage fallback:', storageError);
        }
      }

      // 保存空的文档映射以确保一致性
      await this.saveDocumentMappings();

      console.log('VectorDatabase: Complete database clear finished successfully');
    } catch (error) {
      console.error('VectorDatabase: Failed to clear database:', error);
      throw error;
    }
  }

  /**
   * 强制保存索引并同步文件系统
   */
  private async forceSaveIndex(): Promise<void> {
    try {
      await this.index.writeIndex(this.config.indexFileName);
      await this.syncFileSystem('write'); // 强制同步
    } catch (error) {
      console.error('VectorDatabase: Failed to force save index:', error);
    }
  }

  /**
   * 检查并执行自动清理
   */
  private async checkAndPerformAutoCleanup(): Promise<void> {
    try {
      const currentCount = this.documents.size;
      const maxElements = this.config.maxElements;

      console.log(
        `VectorDatabase: Auto cleanup check - current: ${currentCount}, max: ${maxElements}`,
      );

      // 检查是否超过最大元素数量
      if (currentCount >= maxElements) {
        console.log('VectorDatabase: Document count reached limit, performing cleanup...');
        await this.performLRUCleanup(Math.floor(maxElements * 0.2)); // 清理20%的数据
      }

      // 检查是否有过期数据
      if (this.config.maxRetentionDays && this.config.maxRetentionDays > 0) {
        await this.performTimeBasedCleanup();
      }
    } catch (error) {
      console.error('VectorDatabase: Auto cleanup failed:', error);
    }
  }

  /**
   * 执行基于LRU的清理（删除最旧的文档）
   */
  private async performLRUCleanup(cleanupCount: number): Promise<void> {
    try {
      console.log(
        `VectorDatabase: Starting LRU cleanup, removing ${cleanupCount} oldest documents`,
      );

      // 获取所有文档并按时间戳排序
      const allDocuments = Array.from(this.documents.entries());
      allDocuments.sort((a, b) => a[1].timestamp - b[1].timestamp);

      // 选择要删除的文档
      const documentsToDelete = allDocuments.slice(0, cleanupCount);

      for (const [label, _document] of documentsToDelete) {
        await this.removeDocumentByLabel(label);
      }

      // 保存更新后的索引和映射
      await this.saveIndex();
      await this.saveDocumentMappings();

      console.log(
        `VectorDatabase: LRU cleanup completed, removed ${documentsToDelete.length} documents`,
      );
    } catch (error) {
      console.error('VectorDatabase: LRU cleanup failed:', error);
    }
  }

  /**
   * 执行基于时间的清理（删除过期文档）
   */
  private async performTimeBasedCleanup(): Promise<void> {
    try {
      const maxRetentionMs = this.config.maxRetentionDays! * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - maxRetentionMs;

      console.log(
        `VectorDatabase: Starting time-based cleanup, removing documents older than ${this.config.maxRetentionDays} days`,
      );

      const documentsToDelete: number[] = [];

      for (const [label, document] of this.documents.entries()) {
        if (document.timestamp < cutoffTime) {
          documentsToDelete.push(label);
        }
      }

      for (const label of documentsToDelete) {
        await this.removeDocumentByLabel(label);
      }

      // 保存更新后的索引和映射
      if (documentsToDelete.length > 0) {
        await this.saveIndex();
        await this.saveDocumentMappings();
      }

      console.log(
        `VectorDatabase: Time-based cleanup completed, removed ${documentsToDelete.length} expired documents`,
      );
    } catch (error) {
      console.error('VectorDatabase: Time-based cleanup failed:', error);
    }
  }

  /**
   * 根据标签删除单个文档
   */
  private async removeDocumentByLabel(label: number): Promise<void> {
    try {
      const document = this.documents.get(label);
      if (!document) {
        console.warn(`VectorDatabase: Document with label ${label} not found`);
        return;
      }

      // 从HNSW索引中删除向量
      if (this.index) {
        try {
          this.index.markDelete(label);
        } catch (indexError) {
          console.warn(
            `VectorDatabase: Failed to mark delete in index for label ${label}:`,
            indexError,
          );
        }
      }

      // 从内存映射中删除
      this.documents.delete(label);

      // 从标签页映射中删除
      const tabId = document.tabId;
      if (this.tabDocuments.has(tabId)) {
        this.tabDocuments.get(tabId)!.delete(label);
        // 如果标签页没有其他文档，删除整个标签页映射
        if (this.tabDocuments.get(tabId)!.size === 0) {
          this.tabDocuments.delete(tabId);
        }
      }

      console.log(`VectorDatabase: Removed document with label ${label} from tab ${tabId}`);
    } catch (error) {
      console.error(`VectorDatabase: Failed to remove document with label ${label}:`, error);
    }
  }

  // 私有辅助方法

  private generateDocumentId(tabId: number, chunkIndex: number): string {
    return `tab_${tabId}_chunk_${chunkIndex}_${Date.now()}`;
  }

  private findDocumentByLabel(label: number): VectorDocument | null {
    return this.documents.get(label) || null;
  }

  private async syncFileSystem(direction: 'read' | 'write'): Promise<void> {
    try {
      if (!globalHnswlib) {
        return;
      }

      // 如果已经有同步操作在进行中，等待它完成
      if (syncInProgress && pendingSyncPromise) {
        console.log(`VectorDatabase: Sync already in progress, waiting...`);
        await pendingSyncPromise;
        return;
      }

      // 标记同步开始
      syncInProgress = true;

      // 创建同步 Promise，添加超时机制
      pendingSyncPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn(`VectorDatabase: Filesystem sync (${direction}) timeout`);
          syncInProgress = false;
          pendingSyncPromise = null;
          reject(new Error('Sync timeout'));
        }, 5000); // 5秒超时

        try {
          globalHnswlib.EmscriptenFileSystemManager.syncFS(direction === 'read', () => {
            clearTimeout(timeout);
            console.log(`VectorDatabase: Filesystem sync (${direction}) completed`);
            syncInProgress = false;
            pendingSyncPromise = null;
            resolve();
          });
        } catch (error) {
          clearTimeout(timeout);
          console.warn(`VectorDatabase: Failed to sync filesystem (${direction}):`, error);
          syncInProgress = false;
          pendingSyncPromise = null;
          reject(error);
        }
      });

      await pendingSyncPromise;
    } catch (error) {
      console.warn(`VectorDatabase: Failed to sync filesystem (${direction}):`, error);
      syncInProgress = false;
      pendingSyncPromise = null;
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await this.index.writeIndex(this.config.indexFileName);
      // 减少同步频率，只在必要时同步
      if (this.documents.size % 10 === 0) {
        // 每10个文档同步一次
        await this.syncFileSystem('write');
      }
    } catch (error) {
      console.error('VectorDatabase: Failed to save index:', error);
    }
  }

  private async saveDocumentMappings(): Promise<void> {
    try {
      // 将文档映射保存到 IndexedDB 中
      const mappingData = {
        documents: Array.from(this.documents.entries()),
        tabDocuments: Array.from(this.tabDocuments.entries()).map(([tabId, labels]) => [
          tabId,
          Array.from(labels),
        ]),
        nextLabel: this.nextLabel,
      };

      try {
        // 使用 IndexedDB 保存数据，支持更大的存储容量
        await IndexedDBHelper.saveData(this.config.indexFileName, mappingData);
        console.log('VectorDatabase: Document mappings saved to IndexedDB');
      } catch (idbError) {
        console.warn(
          'VectorDatabase: Failed to save to IndexedDB, falling back to chrome.storage:',
          idbError,
        );

        // 回退到 chrome.storage.local
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          await chrome.storage.local.set({ [storageKey]: mappingData });
          console.log('VectorDatabase: Document mappings saved to chrome.storage.local (fallback)');
        } catch (storageError) {
          console.error(
            'VectorDatabase: Failed to save to both IndexedDB and chrome.storage:',
            storageError,
          );
        }
      }
    } catch (error) {
      console.error('VectorDatabase: Failed to save document mappings:', error);
    }
  }

  public async loadDocumentMappings(): Promise<void> {
    try {
      // 从 IndexedDB 加载文档映射
      if (!globalHnswlib) {
        return;
      }

      let mappingData = null;

      try {
        // 首先尝试从 IndexedDB 读取
        mappingData = await IndexedDBHelper.loadData(this.config.indexFileName);
        if (mappingData) {
          console.log(`VectorDatabase: Loaded document mappings from IndexedDB`);
        }
      } catch (idbError) {
        console.warn(
          'VectorDatabase: Failed to read from IndexedDB, trying chrome.storage:',
          idbError,
        );
      }

      // 如果 IndexedDB 没有数据，尝试从 chrome.storage.local 读取（向后兼容）
      if (!mappingData) {
        try {
          const storageKey = `hnswlib_document_mappings_${this.config.indexFileName}`;
          const result = await chrome.storage.local.get([storageKey]);
          mappingData = result[storageKey];
          if (mappingData) {
            console.log(
              `VectorDatabase: Loaded document mappings from chrome.storage.local (fallback)`,
            );

            // 迁移到 IndexedDB
            try {
              await IndexedDBHelper.saveData(this.config.indexFileName, mappingData);
              console.log('VectorDatabase: Migrated data from chrome.storage to IndexedDB');
            } catch (migrationError) {
              console.warn('VectorDatabase: Failed to migrate data to IndexedDB:', migrationError);
            }
          }
        } catch (storageError) {
          console.warn('VectorDatabase: Failed to read from chrome.storage.local:', storageError);
        }
      }

      if (mappingData) {
        // 恢复文档映射
        this.documents.clear();
        for (const [label, doc] of mappingData.documents) {
          this.documents.set(label, doc);
        }

        // 恢复标签页映射
        this.tabDocuments.clear();
        for (const [tabId, labels] of mappingData.tabDocuments) {
          this.tabDocuments.set(tabId, new Set(labels));
        }

        // 恢复nextLabel - 使用保存的值或计算最大标签+1
        if (mappingData.nextLabel !== undefined) {
          this.nextLabel = mappingData.nextLabel;
        } else if (this.documents.size > 0) {
          // 如果没有保存的nextLabel，计算最大标签+1
          const maxLabel = Math.max(...Array.from(this.documents.keys()));
          this.nextLabel = maxLabel + 1;
        } else {
          this.nextLabel = 0;
        }

        console.log(
          `VectorDatabase: Loaded ${this.documents.size} document mappings, next label: ${this.nextLabel}`,
        );
      } else {
        console.log('VectorDatabase: No existing document mappings found');
      }
    } catch (error) {
      console.error('VectorDatabase: Failed to load document mappings:', error);
    }
  }
}

// 全局 VectorDatabase 单例
let globalVectorDatabase: VectorDatabase | null = null;
let currentDimension: number | null = null;

/**
 * 获取全局 VectorDatabase 单例实例
 * 如果维度发生变化，会重新创建实例以确保兼容性
 */
export async function getGlobalVectorDatabase(
  config?: Partial<VectorDatabaseConfig>,
): Promise<VectorDatabase> {
  const newDimension = config?.dimension || 384;

  // 如果维度发生变化，需要重新创建向量数据库
  if (globalVectorDatabase && currentDimension !== null && currentDimension !== newDimension) {
    console.log(
      `VectorDatabase: Dimension changed from ${currentDimension} to ${newDimension}, recreating instance`,
    );

    // 清理旧实例 - 这会清理索引文件和文档映射
    try {
      await globalVectorDatabase.clear();
      console.log('VectorDatabase: Successfully cleared old instance for dimension change');
    } catch (error) {
      console.warn('VectorDatabase: Error during cleanup:', error);
    }

    globalVectorDatabase = null;
    currentDimension = null;
  }

  if (!globalVectorDatabase) {
    globalVectorDatabase = new VectorDatabase(config);
    currentDimension = newDimension;
    console.log(
      `VectorDatabase: Created global singleton instance with dimension ${currentDimension}`,
    );
  }

  return globalVectorDatabase;
}

/**
 * 同步版本的获取全局 VectorDatabase 实例（用于向后兼容）
 * 注意：如果需要维度变更，建议使用异步版本
 */
export function getGlobalVectorDatabaseSync(
  config?: Partial<VectorDatabaseConfig>,
): VectorDatabase {
  const newDimension = config?.dimension || 384;

  // 如果维度发生变化，记录警告但不清理（避免竞态条件）
  if (globalVectorDatabase && currentDimension !== null && currentDimension !== newDimension) {
    console.warn(
      `VectorDatabase: Dimension mismatch detected (${currentDimension} vs ${newDimension}). Consider using async version for proper cleanup.`,
    );
  }

  if (!globalVectorDatabase) {
    globalVectorDatabase = new VectorDatabase(config);
    currentDimension = newDimension;
    console.log(
      `VectorDatabase: Created global singleton instance with dimension ${currentDimension}`,
    );
  }

  return globalVectorDatabase;
}

/**
 * 重置全局 VectorDatabase 实例（主要用于测试或模型切换）
 */
export async function resetGlobalVectorDatabase(): Promise<void> {
  console.log('VectorDatabase: Starting global instance reset...');

  if (globalVectorDatabase) {
    try {
      console.log('VectorDatabase: Clearing existing global instance...');
      await globalVectorDatabase.clear();
      console.log('VectorDatabase: Global instance cleared successfully');
    } catch (error) {
      console.warn('VectorDatabase: Failed to clear during reset:', error);
    }
  }

  // 额外清理：确保所有可能的IndexedDB数据都被清除
  try {
    console.log('VectorDatabase: Performing comprehensive IndexedDB cleanup...');

    // 清理VectorDatabaseStorage数据库中的所有数据
    await IndexedDBHelper.clearAllData();

    // 清理hnswlib-index数据库中的索引文件
    try {
      console.log('VectorDatabase: Clearing HNSW index files from IndexedDB...');

      // 尝试清理可能存在的索引文件
      const possibleIndexFiles = ['tab_content_index.dat', 'content_index.dat', 'vector_index.dat'];

      // 如果有全局的hnswlib实例，尝试删除已知的索引文件
      if (typeof globalHnswlib !== 'undefined' && globalHnswlib) {
        for (const fileName of possibleIndexFiles) {
          try {
            // 1. 首先尝试物理删除索引文件（使用EmscriptenFileSystemManager）
            try {
              if (globalHnswlib.EmscriptenFileSystemManager.checkFileExists(fileName)) {
                console.log(`VectorDatabase: Deleting physical index file: ${fileName}`);
                globalHnswlib.EmscriptenFileSystemManager.deleteFile(fileName);
                console.log(`VectorDatabase: Physical index file ${fileName} deleted successfully`);
              }
            } catch (fileError) {
              console.log(
                `VectorDatabase: Physical index file ${fileName} not found or failed to delete:`,
                fileError,
              );
            }

            // 2. 删除IndexedDB中的索引文件
            const tempIndex = new globalHnswlib.HierarchicalNSW('cosine', 384);
            await tempIndex.deleteIndex(fileName);
            console.log(`VectorDatabase: Deleted IndexedDB index file: ${fileName}`);
          } catch (deleteError) {
            // 文件可能不存在，这是正常的
            console.log(`VectorDatabase: Index file ${fileName} not found or already deleted`);
          }
        }

        // 3. 强制同步文件系统以确保删除操作生效
        try {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('VectorDatabase: Filesystem sync timeout during cleanup');
              resolve(); // 不阻塞流程
            }, 3000);

            globalHnswlib.EmscriptenFileSystemManager.syncFS(false, () => {
              clearTimeout(timeout);
              console.log('VectorDatabase: Filesystem sync completed during cleanup');
              resolve();
            });
          });
        } catch (syncError) {
          console.warn('VectorDatabase: Failed to sync filesystem during cleanup:', syncError);
        }
      }
    } catch (hnswError) {
      console.warn('VectorDatabase: Failed to clear HNSW index files:', hnswError);
    }

    // 清理可能的chrome.storage备份数据（只清理向量数据库相关的数据，保留用户偏好）
    const possibleKeys = [
      'hnswlib_document_mappings_tab_content_index.dat',
      'hnswlib_document_mappings_content_index.dat',
      'hnswlib_document_mappings_vector_index.dat',
      // 注意：不清理 selectedModel 和 selectedVersion，这些是用户偏好设置
      // 注意：不清理 modelState，这个包含模型状态信息，应该由模型管理逻辑处理
    ];

    if (possibleKeys.length > 0) {
      try {
        await chrome.storage.local.remove(possibleKeys);
        console.log('VectorDatabase: Chrome storage backup data cleared');
      } catch (storageError) {
        console.warn('VectorDatabase: Failed to clear chrome.storage backup:', storageError);
      }
    }

    console.log('VectorDatabase: Comprehensive cleanup completed');
  } catch (cleanupError) {
    console.warn('VectorDatabase: Comprehensive cleanup failed:', cleanupError);
  }

  globalVectorDatabase = null;
  currentDimension = null;
  console.log('VectorDatabase: Global singleton instance reset completed');
}

/**
 * 专门用于模型切换时的数据清理
 * 清理所有IndexedDB数据，包括HNSW索引文件和文档映射
 */
export async function clearAllVectorData(): Promise<void> {
  console.log('VectorDatabase: Starting comprehensive vector data cleanup for model switch...');

  try {
    // 1. 清理全局实例
    if (globalVectorDatabase) {
      try {
        await globalVectorDatabase.clear();
      } catch (error) {
        console.warn('VectorDatabase: Failed to clear global instance:', error);
      }
    }

    // 2. 清理VectorDatabaseStorage数据库
    try {
      console.log('VectorDatabase: Clearing VectorDatabaseStorage database...');
      await IndexedDBHelper.clearAllData();
    } catch (error) {
      console.warn('VectorDatabase: Failed to clear VectorDatabaseStorage:', error);
    }

    // 3. 清理hnswlib-index数据库和物理文件
    try {
      console.log('VectorDatabase: Clearing hnswlib-index database and physical files...');

      // 3.1 首先尝试物理删除索引文件（使用EmscriptenFileSystemManager）
      if (typeof globalHnswlib !== 'undefined' && globalHnswlib) {
        const possibleIndexFiles = [
          'tab_content_index.dat',
          'content_index.dat',
          'vector_index.dat',
        ];

        for (const fileName of possibleIndexFiles) {
          try {
            if (globalHnswlib.EmscriptenFileSystemManager.checkFileExists(fileName)) {
              console.log(`VectorDatabase: Deleting physical index file: ${fileName}`);
              globalHnswlib.EmscriptenFileSystemManager.deleteFile(fileName);
              console.log(`VectorDatabase: Physical index file ${fileName} deleted successfully`);
            }
          } catch (fileError) {
            console.log(
              `VectorDatabase: Physical index file ${fileName} not found or failed to delete:`,
              fileError,
            );
          }
        }

        // 强制同步文件系统
        try {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              console.warn('VectorDatabase: Filesystem sync timeout during model switch cleanup');
              resolve();
            }, 3000);

            globalHnswlib.EmscriptenFileSystemManager.syncFS(false, () => {
              clearTimeout(timeout);
              console.log('VectorDatabase: Filesystem sync completed during model switch cleanup');
              resolve();
            });
          });
        } catch (syncError) {
          console.warn(
            'VectorDatabase: Failed to sync filesystem during model switch cleanup:',
            syncError,
          );
        }
      }

      // 3.2 删除整个hnswlib-index数据库
      await new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase('/hnswlib-index');
        deleteRequest.onsuccess = () => {
          console.log('VectorDatabase: Successfully deleted /hnswlib-index database');
          resolve();
        };
        deleteRequest.onerror = () => {
          console.warn(
            'VectorDatabase: Failed to delete /hnswlib-index database:',
            deleteRequest.error,
          );
          resolve(); // 不阻塞流程
        };
        deleteRequest.onblocked = () => {
          console.warn('VectorDatabase: Deletion of /hnswlib-index database was blocked');
          resolve(); // 不阻塞流程
        };
      });
    } catch (error) {
      console.warn(
        'VectorDatabase: Failed to clear hnswlib-index database and physical files:',
        error,
      );
    }

    // 4. 清理chrome.storage中的备份数据
    try {
      const storageKeys = [
        'hnswlib_document_mappings_tab_content_index.dat',
        'hnswlib_document_mappings_content_index.dat',
        'hnswlib_document_mappings_vector_index.dat',
      ];
      await chrome.storage.local.remove(storageKeys);
      console.log('VectorDatabase: Chrome storage backup data cleared');
    } catch (error) {
      console.warn('VectorDatabase: Failed to clear chrome.storage backup:', error);
    }

    // 5. 重置全局状态
    globalVectorDatabase = null;
    currentDimension = null;

    console.log('VectorDatabase: Comprehensive vector data cleanup completed successfully');
  } catch (error) {
    console.error('VectorDatabase: Comprehensive vector data cleanup failed:', error);
    throw error;
  }
}
