<template>
  <div class="popup-container">
    <div class="header">
      <div class="header-content">
        <h1 class="header-title">Chrome MCP Server</h1>
      </div>
    </div>
    <div class="content">
      <div class="section">
        <h2 class="section-title">Native Server 配置</h2>
        <div class="config-card">
          <div class="status-section">
            <div class="status-header">
              <p class="status-label">运行状态</p>
              <button class="refresh-status-button" @click="refreshServerStatus" title="刷新状态">
                🔄
              </button>
            </div>
            <div class="status-info">
              <span :class="['status-dot', getStatusClass()]"></span>
              <span class="status-text">{{ getStatusText() }}</span>
            </div>
            <div v-if="serverStatus.lastUpdated" class="status-timestamp">
              最后更新: {{ new Date(serverStatus.lastUpdated).toLocaleTimeString() }}
            </div>
          </div>

          <!-- MCP 服务器配置信息 -->
          <div v-if="showMcpConfig" class="mcp-config-section">
            <div class="mcp-config-header">
              <p class="mcp-config-label">MCP 服务器配置</p>
              <button class="copy-config-button" @click="copyMcpConfig">
                {{ copyButtonText }}
              </button>
            </div>
            <div class="mcp-config-content">
              <pre class="mcp-config-json">{{ mcpConfigJson }}</pre>
            </div>
          </div>
          <div class="port-section">
            <label for="port" class="port-label">连接端口</label>
            <input
              type="text"
              id="port"
              :value="nativeServerPort"
              @input="updatePort"
              class="port-input"
            />
          </div>

          <button class="connect-button" :disabled="isConnecting" @click="testNativeConnection">
            <BoltIcon />
            <span>{{
              isConnecting ? '连接中...' : nativeConnectionStatus === 'connected' ? '断开' : '连接'
            }}</span>
          </button>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Embedding模型</h2>

        <!-- 模型切换进度指示器 -->
        <ProgressIndicator
          v-if="isModelSwitching || isModelDownloading"
          :visible="isModelSwitching || isModelDownloading"
          :text="getProgressText()"
          :showSpinner="true"
        />

        <!-- 模型错误提示和重试 -->
        <div v-if="modelInitializationStatus === 'error'" class="error-card">
          <div class="error-content">
            <div class="error-icon">⚠️</div>
            <div class="error-details">
              <p class="error-title">模型初始化失败</p>
              <p class="error-message">{{ modelErrorMessage || '模型加载失败' }}</p>
              <p class="error-suggestion">{{ getErrorTypeText() }}</p>
            </div>
          </div>
          <button
            class="retry-button"
            @click="retryModelInitialization"
            :disabled="isModelSwitching || isModelDownloading"
          >
            <span>🔄</span>
            <span>重试</span>
          </button>
        </div>

        <div class="model-list">
          <div
            v-for="model in availableModels"
            :key="model.preset"
            :class="[
              'model-card',
              {
                selected: currentModel === model.preset,
                disabled: isModelSwitching || isModelDownloading,
              },
            ]"
            @click="
              !isModelSwitching && !isModelDownloading && switchModel(model.preset as ModelPreset)
            "
          >
            <div class="model-header">
              <div class="model-info">
                <p class="model-name" :class="{ 'selected-text': currentModel === model.preset }">
                  {{ model.preset }}
                </p>
                <p class="model-description">{{ getModelDescription(model) }}</p>
              </div>
              <div v-if="currentModel === model.preset" class="check-icon">
                <CheckIcon class="text-white" />
              </div>
            </div>
            <div class="model-tags">
              <span class="model-tag performance">{{ getPerformanceText(model.performance) }}</span>
              <span class="model-tag size">{{ model.size }}</span>
              <span class="model-tag dimension">{{ model.dimension }}D</span>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">索引数据管理</h2>
        <div class="stats-grid">
          <div class="stats-card">
            <div class="stats-header">
              <p class="stats-label">已索引页面</p>
              <span class="stats-icon violet">
                <DocumentIcon />
              </span>
            </div>
            <p class="stats-value">{{ storageStats?.indexedPages || 0 }}</p>
          </div>

          <div class="stats-card">
            <div class="stats-header">
              <p class="stats-label">索引大小</p>
              <span class="stats-icon teal">
                <DatabaseIcon />
              </span>
            </div>
            <p class="stats-value">{{ formatIndexSize() }}</p>
          </div>

          <div class="stats-card">
            <div class="stats-header">
              <p class="stats-label">活跃标签页</p>
              <span class="stats-icon blue">
                <TabIcon />
              </span>
            </div>
            <p class="stats-value">{{ getActiveTabsCount() }}</p>
          </div>

          <div class="stats-card">
            <div class="stats-header">
              <p class="stats-label">向量文档</p>
              <span class="stats-icon green">
                <VectorIcon />
              </span>
            </div>
            <p class="stats-value">{{ storageStats?.totalDocuments || 0 }}</p>
          </div>
        </div>
        <!-- 数据清空进度指示器 -->
        <ProgressIndicator
          v-if="isClearingData && clearDataProgress"
          :visible="isClearingData"
          :text="clearDataProgress"
          :showSpinner="true"
        />

        <button
          class="danger-button"
          :disabled="isClearingData"
          @click="showClearConfirmation = true"
        >
          <TrashIcon />
          <span>{{ isClearingData ? '清空中...' : '清空所有数据' }}</span>
        </button>
      </div>
    </div>

    <div class="footer">
      <p class="footer-text">chrome mcp server for ai</p>
    </div>

    <ConfirmDialog
      :visible="showClearConfirmation"
      title="确认清空数据"
      message="此操作将清空所有已索引的网页内容和向量数据，包括："
      :items="['所有网页的文本内容索引', '向量嵌入数据', '搜索历史和缓存']"
      warning="此操作不可撤销！清空后需要重新浏览网页来重建索引。"
      icon="⚠️"
      confirm-text="确认清空"
      cancel-text="取消"
      confirming-text="清空中..."
      :is-confirming="isClearingData"
      @confirm="confirmClearAllData"
      @cancel="hideClearDataConfirmation"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import {
  PREDEFINED_MODELS,
  type ModelPreset,
  getModelInfo,
} from '@/utils/semantic-similarity-engine';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

import ConfirmDialog from './components/ConfirmDialog.vue';
import ProgressIndicator from './components/ProgressIndicator.vue';
import {
  DocumentIcon,
  DatabaseIcon,
  BoltIcon,
  TrashIcon,
  CheckIcon,
  TabIcon,
  VectorIcon,
} from './components/icons';

const nativeConnectionStatus = ref<'unknown' | 'connected' | 'disconnected'>('unknown');
const isConnecting = ref(false);
const nativeServerPort = ref<number>(12306);

// Server status management
const serverStatus = ref<{
  isRunning: boolean;
  port?: number;
  lastUpdated: number;
}>({
  isRunning: false,
  lastUpdated: Date.now(),
});

// MCP 配置管理
const showMcpConfig = computed(() => {
  return nativeConnectionStatus.value === 'connected' && serverStatus.value.isRunning;
});

const copyButtonText = ref('复制配置');

const mcpConfigJson = computed(() => {
  const port = serverStatus.value.port || nativeServerPort.value;
  const config = {
    mcpServers: {
      'streamable-mcp-server': {
        type: 'streamable-http',
        url: `http://127.0.0.1:${port}/mcp`,
      },
    },
  };
  return JSON.stringify(config, null, 2);
});

const currentModel = ref<ModelPreset | null>(null);
const isModelSwitching = ref(false);
const modelSwitchProgress = ref('');

const modelDownloadProgress = ref<number>(0);
const isModelDownloading = ref(false);
const modelInitializationStatus = ref<'idle' | 'downloading' | 'initializing' | 'ready' | 'error'>(
  'idle',
);
const modelErrorMessage = ref<string>('');
const modelErrorType = ref<'network' | 'file' | 'unknown' | ''>('');

// 固定使用量化版本
const selectedVersion = ref<'quantized'>('quantized');

const storageStats = ref<{
  indexedPages: number;
  totalDocuments: number;
  totalTabs: number;
  indexSize: number;
  isInitialized: boolean;
} | null>(null);
const isRefreshingStats = ref(false);
const isClearingData = ref(false);
const showClearConfirmation = ref(false);
const clearDataProgress = ref('');

const availableModels = computed(() => {
  return Object.entries(PREDEFINED_MODELS).map(([key, value]) => ({
    preset: key as ModelPreset,
    ...value,
  }));
});

const getStatusClass = () => {
  // Priority: Server status > Connection status
  if (nativeConnectionStatus.value === 'connected') {
    if (serverStatus.value.isRunning) {
      return 'bg-emerald-500'; // Green: Connected and server running
    } else {
      return 'bg-yellow-500'; // Yellow: Connected but server not running
    }
  } else if (nativeConnectionStatus.value === 'disconnected') {
    return 'bg-red-500'; // Red: Not connected
  } else {
    return 'bg-gray-500'; // Gray: Unknown status
  }
};

const getStatusText = () => {
  if (nativeConnectionStatus.value === 'connected') {
    if (serverStatus.value.isRunning) {
      return `服务运行中 (端口: ${serverStatus.value.port || 'Unknown'})`;
    } else {
      return '已连接，服务未启动';
    }
  } else if (nativeConnectionStatus.value === 'disconnected') {
    return '服务未连接';
  } else {
    return '检测中...';
  }
};

const formatIndexSize = () => {
  if (!storageStats.value?.indexSize) return '0 MB';
  const sizeInMB = Math.round(storageStats.value.indexSize / (1024 * 1024));
  return `${sizeInMB} MB`;
};

const getModelDescription = (model: any) => {
  switch (model.preset) {
    case 'multilingual-e5-small':
      return '轻量级多语言模型';
    case 'multilingual-e5-base':
      return '比e5-small稍大，但效果更好';
    default:
      return '多语言语义模型';
  }
};

const getPerformanceText = (performance: string) => {
  switch (performance) {
    case 'outstanding':
      return '⭐️ 顶级';
    case 'excellent':
      return '😁 优秀';
    case 'high':
      return '⚡ 高性能';
    case 'medium':
      return '📊 中等';
    default:
      return '📊 中等';
  }
};

const getProgressText = () => {
  if (modelSwitchProgress.value) {
    return modelSwitchProgress.value;
  }

  switch (modelInitializationStatus.value) {
    case 'downloading':
      return `正在下载模型... ${Math.round(modelDownloadProgress.value)}%`;
    case 'initializing':
      return '正在初始化模型...';
    case 'ready':
      return '模型已就绪';
    case 'error':
      return modelErrorMessage.value || '模型加载失败';
    default:
      return '准备中...';
  }
};

const getErrorTypeText = () => {
  switch (modelErrorType.value) {
    case 'network':
      return '网络连接错误，请检查网络连接后重试';
    case 'file':
      return '模型文件损坏或不完整，请重试下载';
    case 'unknown':
    default:
      return '未知错误，请检查你的网络是否可以访问huggingface';
  }
};

const retryModelInitialization = async () => {
  if (!currentModel.value) return;

  console.log('🔄 Retrying model initialization...');

  // 清除错误状态
  modelErrorMessage.value = '';
  modelErrorType.value = '';
  modelInitializationStatus.value = 'downloading';
  modelDownloadProgress.value = 0;
  isModelDownloading.value = true;

  // 重新切换到当前模型（强制重新初始化）
  await switchModel(currentModel.value);
};

const updatePort = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const newPort = Number(target.value);
  nativeServerPort.value = newPort;
  // 自动保存端口设置
  await savePortPreference(newPort);
};

const getActiveTabsCount = () => {
  return storageStats.value?.totalTabs || 0;
};

const checkNativeConnection = async () => {
  try {
    // 发送 ping 消息检测连接状态
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({ type: 'ping_native' });
    nativeConnectionStatus.value = response?.connected ? 'connected' : 'disconnected';
  } catch (error) {
    console.error('检测 Native 连接状态失败:', error);
    nativeConnectionStatus.value = 'disconnected';
  }
};

const checkServerStatus = async () => {
  try {
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }
    // Also update connection status from the same response
    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    console.error('检测服务器状态失败:', error);
  }
};

const refreshServerStatus = async () => {
  try {
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }
    // Also update connection status from the same response
    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    console.error('刷新服务器状态失败:', error);
  }
};

const copyMcpConfig = async () => {
  try {
    await navigator.clipboard.writeText(mcpConfigJson.value);
    copyButtonText.value = '✅已复制';

    setTimeout(() => {
      copyButtonText.value = '复制配置';
    }, 2000);
  } catch (error) {
    console.error('复制配置失败:', error);
    copyButtonText.value = '❌复制失败';

    setTimeout(() => {
      copyButtonText.value = '复制配置';
    }, 2000);
  }
};

const testNativeConnection = async () => {
  if (isConnecting.value) return;
  isConnecting.value = true;
  try {
    if (nativeConnectionStatus.value === 'connected') {
      // 断开连接
      // eslint-disable-next-line no-undef
      await chrome.runtime.sendMessage({ type: 'disconnect_native' });
      nativeConnectionStatus.value = 'disconnected';
    } else {
      // 连接
      console.log(`尝试连接到端口: ${nativeServerPort.value}`);
      // eslint-disable-next-line no-undef
      const response = await chrome.runtime.sendMessage({
        type: 'connectNative',
        port: nativeServerPort.value,
      });
      if (response && response.success) {
        nativeConnectionStatus.value = 'connected';
        console.log('连接成功:', response);
        // 保存端口设置
        await savePortPreference(nativeServerPort.value);
      } else {
        nativeConnectionStatus.value = 'disconnected';
        console.error('连接失败:', response);
      }
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    nativeConnectionStatus.value = 'disconnected';
  } finally {
    isConnecting.value = false;
  }
};

const loadModelPreference = async () => {
  try {
    console.log('🔄 Loading model preferences from storage...');
    // eslint-disable-next-line no-undef
    const result = await chrome.storage.local.get([
      'selectedModel',
      'selectedVersion',
      'modelState',
    ]);
    console.log('💾 Storage result:', result);

    // 恢复模型偏好 - 确保正确处理存储的值
    if (result.selectedModel) {
      const storedModel = result.selectedModel as string;
      console.log('📋 Stored model from storage:', storedModel);

      // 验证存储的模型是否在预定义模型中存在
      if (PREDEFINED_MODELS[storedModel as ModelPreset]) {
        currentModel.value = storedModel as ModelPreset;
        console.log(`✅ Loaded valid model: ${currentModel.value}`);
      } else {
        console.warn(
          `⚠️ Stored model "${storedModel}" not found in PREDEFINED_MODELS, using default`,
        );
        currentModel.value = 'multilingual-e5-small'; // 设置默认模型
        // 保存默认模型到存储
        await saveModelPreference(currentModel.value);
      }
    } else {
      console.log('⚠️ No model found in storage, using default');
      currentModel.value = 'multilingual-e5-small'; // 设置默认模型
      // 保存默认模型到存储
      await saveModelPreference(currentModel.value);
    }

    // 固定使用量化版本，不需要从存储恢复
    selectedVersion.value = 'quantized';
    console.log('✅ Using quantized version (fixed)');

    // 确保存储中也是量化版本
    await saveVersionPreference('quantized');

    // 恢复模型状态
    if (result.modelState) {
      const modelState = result.modelState;
      modelInitializationStatus.value = modelState.status || 'idle';
      modelDownloadProgress.value = modelState.downloadProgress || 0;
      isModelDownloading.value = modelState.isDownloading || false;
      console.log(`✅ Loaded model state: ${modelState.status}`);

      // 如果模型正在下载或初始化，开始监听状态更新
      if (modelState.status === 'downloading' || modelState.status === 'initializing') {
        startModelStatusMonitoring();
      }
    } else {
      console.log('⚠️ No model state found in storage');
    }

    console.log(
      `📊 Final UI state - Model: ${currentModel.value}, Version: ${selectedVersion.value}`,
    );
  } catch (error) {
    console.error('❌ 加载模型偏好失败:', error);
  }
};

const saveModelPreference = async (model: ModelPreset) => {
  try {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ selectedModel: model });
  } catch (error) {
    console.error('保存模型偏好失败:', error);
  }
};

const saveVersionPreference = async (version: 'full' | 'quantized' | 'compressed') => {
  try {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ selectedVersion: version });
  } catch (error) {
    console.error('保存版本偏好失败:', error);
  }
};

const savePortPreference = async (port: number) => {
  try {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ nativeServerPort: port });
    console.log(`端口偏好已保存: ${port}`);
  } catch (error) {
    console.error('保存端口偏好失败:', error);
  }
};

const loadPortPreference = async () => {
  try {
    // eslint-disable-next-line no-undef
    const result = await chrome.storage.local.get(['nativeServerPort']);
    if (result.nativeServerPort) {
      nativeServerPort.value = result.nativeServerPort;
      console.log(`端口偏好已加载: ${result.nativeServerPort}`);
    }
  } catch (error) {
    console.error('加载端口偏好失败:', error);
  }
};

const saveModelState = async () => {
  try {
    const modelState = {
      status: modelInitializationStatus.value,
      downloadProgress: modelDownloadProgress.value,
      isDownloading: isModelDownloading.value,
      lastUpdated: Date.now(),
    };
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({ modelState });
  } catch (error) {
    console.error('保存模型状态失败:', error);
  }
};

// 模型状态监听
let statusMonitoringInterval: ReturnType<typeof setInterval> | null = null;

const startModelStatusMonitoring = () => {
  if (statusMonitoringInterval) {
    clearInterval(statusMonitoringInterval);
  }

  statusMonitoringInterval = setInterval(async () => {
    try {
      // eslint-disable-next-line no-undef
      const response = await chrome.runtime.sendMessage({
        type: 'get_model_status',
      });

      if (response && response.success) {
        const status = response.status;
        modelInitializationStatus.value = status.initializationStatus || 'idle';
        modelDownloadProgress.value = status.downloadProgress || 0;
        isModelDownloading.value = status.isDownloading || false;

        // 更新错误信息
        if (status.initializationStatus === 'error') {
          modelErrorMessage.value = status.errorMessage || '模型加载失败';
          modelErrorType.value = status.errorType || 'unknown';
        } else {
          // 清除错误信息
          modelErrorMessage.value = '';
          modelErrorType.value = '';
        }

        // 保存状态
        await saveModelState();

        // 如果完成或出错，停止监听
        if (status.initializationStatus === 'ready' || status.initializationStatus === 'error') {
          stopModelStatusMonitoring();
        }
      }
    } catch (error) {
      console.error('获取模型状态失败:', error);
    }
  }, 1000); // 每秒检查一次
};

const stopModelStatusMonitoring = () => {
  if (statusMonitoringInterval) {
    clearInterval(statusMonitoringInterval);
    statusMonitoringInterval = null;
  }
};

// 数据管理相关方法
const refreshStorageStats = async () => {
  if (isRefreshingStats.value) return;

  isRefreshingStats.value = true;
  try {
    console.log('🔄 Refreshing storage statistics...');

    // 发送消息到background script获取统计信息
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: 'get_storage_stats',
    });

    if (response && response.success) {
      storageStats.value = {
        indexedPages: response.stats.indexedPages || 0,
        totalDocuments: response.stats.totalDocuments || 0,
        totalTabs: response.stats.totalTabs || 0,
        indexSize: response.stats.indexSize || 0,
        isInitialized: response.stats.isInitialized || false,
      };
      console.log('✅ Storage stats refreshed:', storageStats.value);
    } else {
      console.error('❌ Failed to get storage stats:', response?.error);
      // 设置默认值
      storageStats.value = {
        indexedPages: 0,
        totalDocuments: 0,
        totalTabs: 0,
        indexSize: 0,
        isInitialized: false,
      };
    }
  } catch (error) {
    console.error('❌ Error refreshing storage stats:', error);
    // 设置默认值
    storageStats.value = {
      indexedPages: 0,
      totalDocuments: 0,
      totalTabs: 0,
      indexSize: 0,
      isInitialized: false,
    };
  } finally {
    isRefreshingStats.value = false;
  }
};

const hideClearDataConfirmation = () => {
  showClearConfirmation.value = false;
};

const confirmClearAllData = async () => {
  if (isClearingData.value) return;

  isClearingData.value = true;
  clearDataProgress.value = '正在清空所有数据...';

  try {
    console.log('🗑️ Starting to clear all data...');

    // 发送消息到background script清空所有数据
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: 'clear_all_data',
    });

    if (response && response.success) {
      clearDataProgress.value = '数据清空成功！';
      console.log('✅ All data cleared successfully');

      // 刷新统计信息
      await refreshStorageStats();

      setTimeout(() => {
        clearDataProgress.value = '';
        hideClearDataConfirmation();
      }, 2000);
    } else {
      throw new Error(response?.error || '清空数据失败');
    }
  } catch (error: any) {
    console.error('❌ Failed to clear all data:', error);
    clearDataProgress.value = `清空数据失败: ${error?.message || '未知错误'}`;

    // 显示错误消息更长时间
    setTimeout(() => {
      clearDataProgress.value = '';
    }, 5000);
  } finally {
    isClearingData.value = false;
  }
};

const switchModel = async (newModel: ModelPreset) => {
  console.log(`🔄 switchModel called with newModel: ${newModel}`);

  // 检查是否真的需要切换
  if (isModelSwitching.value) {
    console.log('⏸️ Model switch already in progress, skipping');
    return;
  }

  const isSameModel = newModel === currentModel.value;
  const currentModelInfo = currentModel.value
    ? getModelInfo(currentModel.value)
    : getModelInfo('multilingual-e5-small');
  const newModelInfo = getModelInfo(newModel);
  const isDifferentDimension = currentModelInfo.dimension !== newModelInfo.dimension;

  console.log(`📊 Switch analysis:`);
  console.log(`   - Same model: ${isSameModel} (${currentModel.value} -> ${newModel})`);
  console.log(
    `   - Current dimension: ${currentModelInfo.dimension}, New dimension: ${newModelInfo.dimension}`,
  );
  console.log(`   - Different dimension: ${isDifferentDimension}`);

  // 如果是相同模型且维度相同，则跳过切换
  if (isSameModel && !isDifferentDimension) {
    console.log('✅ Same model and dimension - no need to switch');
    return;
  }

  // 记录切换原因
  const switchReasons = [];
  if (!isSameModel) switchReasons.push('different model');
  if (isDifferentDimension) switchReasons.push('different dimension');

  console.log(`🚀 Switching model due to: ${switchReasons.join(', ')}`);
  console.log(
    `📋 Model: ${currentModel.value} (${currentModelInfo.dimension}D) -> ${newModel} (${newModelInfo.dimension}D)`,
  );

  isModelSwitching.value = true;
  modelSwitchProgress.value = '正在切换模型...';

  // 重置模型状态
  modelInitializationStatus.value = 'downloading';
  modelDownloadProgress.value = 0;
  isModelDownloading.value = true;

  try {
    // 1. 保存模型偏好和版本偏好
    await saveModelPreference(newModel);
    await saveVersionPreference('quantized'); // 固定使用量化版本
    await saveModelState();

    modelSwitchProgress.value = '正在重新初始化语义引擎...';

    // 2. 开始监听模型状态
    startModelStatusMonitoring();

    // 3. 通知 background script 切换模型，包含维度信息
    // eslint-disable-next-line no-undef
    const response = await chrome.runtime.sendMessage({
      type: 'switch_semantic_model',
      modelPreset: newModel,
      modelVersion: 'quantized', // 固定使用量化版本
      modelDimension: newModelInfo.dimension, // 传递新模型的维度信息
      previousDimension: currentModelInfo.dimension, // 传递旧模型的维度信息
    });

    if (response && response.success) {
      currentModel.value = newModel;
      modelSwitchProgress.value = '模型切换成功！';
      console.log(
        '模型切换成功:',
        newModel,
        'version: quantized',
        'dimension:',
        newModelInfo.dimension,
      );

      // 更新状态为就绪
      modelInitializationStatus.value = 'ready';
      isModelDownloading.value = false;
      await saveModelState();

      // 短暂显示成功消息
      setTimeout(() => {
        modelSwitchProgress.value = '';
      }, 2000);
    } else {
      throw new Error(response?.error || '模型切换失败');
    }
  } catch (error: any) {
    console.error('模型切换失败:', error);
    modelSwitchProgress.value = `模型切换失败: ${error?.message || '未知错误'}`;

    // 更新状态为错误，并设置错误信息
    modelInitializationStatus.value = 'error';
    isModelDownloading.value = false;

    // 分析错误类型
    const errorMessage = error?.message || '未知错误';
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('fetch') ||
      errorMessage.includes('timeout')
    ) {
      modelErrorType.value = 'network';
      modelErrorMessage.value = '网络连接失败，无法下载模型文件';
    } else if (
      errorMessage.includes('corrupt') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('format')
    ) {
      modelErrorType.value = 'file';
      modelErrorMessage.value = '模型文件损坏或格式错误';
    } else {
      modelErrorType.value = 'unknown';
      modelErrorMessage.value = errorMessage;
    }

    await saveModelState();

    // 显示错误消息更长时间
    setTimeout(() => {
      modelSwitchProgress.value = '';
    }, 8000); // 延长到8秒
  } finally {
    isModelSwitching.value = false;
  }
};
// Listen for server status changes
const setupServerStatusListener = () => {
  // eslint-disable-next-line no-undef
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
      serverStatus.value = message.payload;
      console.log('Server status updated:', message.payload);
    }
  });
};

onMounted(async () => {
  await loadPortPreference();
  await loadModelPreference();
  await checkNativeConnection();
  await checkServerStatus();
  await refreshStorageStats();
  setupServerStatusListener();
});

const cleanup = () => {
  stopModelStatusMonitoring();
};

onUnmounted(() => {
  cleanup();
});
</script>

<style scoped>
.popup-container {
  background: #f1f5f9;
  border-radius: 24px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Header */
.header {
  flex-shrink: 0;
  padding-left: 20px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.settings-button {
  padding: 8px;
  border-radius: 50%;
  color: #64748b;
  background: none;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-button:hover {
  background: #e2e8f0;
  color: #1e293b;
}

/* Content */
.content {
  flex-grow: 1;
  padding: 8px 24px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.content::-webkit-scrollbar {
  display: none;
}

/* Status Card */
.status-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 20px;
  margin-bottom: 20px;
}

.status-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin-bottom: 8px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  height: 8px;
  width: 8px;
  border-radius: 50%;
}

.status-dot.bg-emerald-500 {
  background-color: #10b981;
}

.status-dot.bg-red-500 {
  background-color: #ef4444;
}

.status-dot.bg-yellow-500 {
  background-color: #eab308;
}

.status-dot.bg-gray-500 {
  background-color: #6b7280;
}

.status-text {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.model-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin-bottom: 4px;
}

.model-name {
  font-weight: 600;
  color: #7c3aed;
}

/* Stats Grid (2x2) */
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* Stats Cards */
.stats-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 16px;
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stats-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
}

.stats-icon {
  padding: 8px;
  border-radius: 8px;
}

.stats-icon.violet {
  background: #ede9fe;
  color: #7c3aed;
}

.stats-icon.teal {
  background: #ccfbf1;
  color: #0d9488;
}

.stats-icon.blue {
  background: #dbeafe;
  color: #2563eb;
}

.stats-icon.green {
  background: #dcfce7;
  color: #16a34a;
}

.stats-value {
  font-size: 30px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

/* Section */
.section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 12px;
}

/* Current Model Card */
.current-model-card {
  background: linear-gradient(135deg, #faf5ff, #f3e8ff);
  border: 1px solid #e9d5ff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.current-model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.current-model-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin: 0;
}

.current-model-badge {
  background: #8b5cf6;
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}

.current-model-name {
  font-size: 16px;
  font-weight: 700;
  color: #7c3aed;
  margin: 0;
}

/* Model Management */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.model-card:hover {
  border-color: #8b5cf6;
}

.model-card.selected {
  border: 2px solid #8b5cf6;
  background: #faf5ff;
}

.model-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.model-info {
  flex: 1;
}

.model-name {
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.model-name.selected-text {
  color: #7c3aed;
}

.model-description {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

.check-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  background: #8b5cf6;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* Model Tags */
.model-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
}

.model-tag.performance {
  background: #d1fae5;
  color: #065f46;
}

.model-tag.size {
  background: #ddd6fe;
  color: #5b21b6;
}

.model-tag.dimension {
  background: #e5e7eb;
  color: #4b5563;
}

/* Config Card */
.config-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.refresh-status-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 14px;
  color: #64748b;
  transition: all 0.2s ease;
}

.refresh-status-button:hover {
  background: #f1f5f9;
  color: #374151;
}

.status-timestamp {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 4px;
}

.mcp-config-section {
  border-top: 1px solid #f1f5f9;
}

.mcp-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mcp-config-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin: 0;
}

.copy-config-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 14px;
  color: #64748b;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}

.copy-config-button:hover {
  background: #f1f5f9;
  color: #374151;
}

.mcp-config-content {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}

.mcp-config-json {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #374151;
  margin: 0;
  white-space: pre;
  overflow-x: auto;
}

.port-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.port-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
}

.port-input {
  display: block;
  width: 100%;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  padding: 12px;
  font-size: 14px;
  background: #f8fafc;
}

.port-input:focus {
  outline: none;
  border-color: #8b5cf6;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
}

/* Connect Button */
.connect-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #8b5cf6;
  color: white;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.connect-button:hover:not(:disabled) {
  background: #7c3aed;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.connect-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Error Card */
.error-card {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.error-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.error-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.error-details {
  flex: 1;
}

.error-title {
  font-size: 14px;
  font-weight: 600;
  color: #dc2626;
  margin: 0 0 4px 0;
}

.error-message {
  font-size: 14px;
  color: #991b1b;
  margin: 0 0 8px 0;
  font-weight: 500;
}

.error-suggestion {
  font-size: 13px;
  color: #7f1d1d;
  margin: 0;
  line-height: 1.4;
}

/* Retry Button */
.retry-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #dc2626;
  color: white;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
  flex-shrink: 0;
}

.retry-button:hover:not(:disabled) {
  background: #b91c1c;
}

.retry-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Danger Button */
.danger-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: white;
  border: 1px solid #d1d5db;
  color: #374151;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 16px;
}

.danger-button:hover:not(:disabled) {
  border-color: #ef4444;
  color: #dc2626;
}

.danger-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Icon Sizes */
.icon-small {
  width: 14px;
  height: 14px;
}

.icon-default {
  width: 20px;
  height: 20px;
}

.icon-medium {
  width: 24px;
  height: 24px;
}

/* Footer */
.footer {
  padding: 16px;
  margin-top: auto;
}

.footer-text {
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  margin: 0;
}

/* 响应式设计 */
@media (max-width: 320px) {
  .popup-container {
    width: 100%;
    height: 100vh;
    border-radius: 0;
  }

  .header {
    padding: 24px 20px 12px;
  }

  .content {
    padding: 8px 20px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .config-card {
    padding: 16px;
    gap: 12px;
  }

  .current-model-card {
    padding: 12px;
    margin-bottom: 12px;
  }

  .stats-card {
    padding: 12px;
  }

  .stats-value {
    font-size: 24px;
  }
}
</style>
