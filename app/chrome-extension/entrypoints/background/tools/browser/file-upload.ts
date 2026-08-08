import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

/** One file to attach. Exactly one source is used, in path/url/base64 order. */
interface FileSource {
  filePath?: string;
  fileUrl?: string;
  base64Data?: string;
  fileName?: string;
}

/**
 * How the page takes the file.
 *
 * - `input`  set files on an `<input type="file">` that is already in the DOM.
 *            Works even when the input is hidden behind a styled button, which
 *            is how most sites build an "Attach" control.
 * - `picker` click something that opens the OS file dialog, and answer the
 *            dialog. For sites that create the input on click, or use the File
 *            System Access API and have no input at all.
 */
type UploadMode = 'input' | 'picker';

interface FileUploadToolParams {
  /** CSS selector for the file input. Required for mode "input". */
  selector?: string;
  /** CSS selector for the control that opens the picker. Required for mode "picker". */
  triggerSelector?: string;
  mode?: UploadMode;

  /** Preferred form: one entry per file. */
  files?: FileSource[];

  /** Single-file form, kept so existing callers keep working. */
  filePath?: string;
  fileUrl?: string;
  base64Data?: string;
  fileName?: string;

  tabId?: number;
  windowId?: number;
  timeoutMs?: number;
}

const DEFAULT_PICKER_TIMEOUT_MS = 10000;

/**
 * Uploads files through the Chrome DevTools Protocol, the same mechanism
 * Playwright's `setInputFiles` uses.
 *
 * CDP reads the file itself, so bytes never pass through the extension for a
 * local path. A URL or inline base64 is materialised into the native host's
 * temp directory first and the resulting path is handed to CDP.
 */
class FileUploadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILE_UPLOAD;

  async execute(args: FileUploadToolParams): Promise<ToolResult> {
    const mode: UploadMode = args.mode ?? 'input';
    const sources = collectSources(args);

    if (sources.length === 0) {
      return createErrorResponse('Provide files[], or one of filePath, fileUrl, or base64Data');
    }
    if (mode === 'input' && !args.selector) {
      return createErrorResponse('selector is required for mode "input"');
    }
    if (mode === 'picker' && !args.triggerSelector) {
      return createErrorResponse('triggerSelector is required for mode "picker"');
    }

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) return createErrorResponse('No active tab found');
      const tabId = tab.id;

      // Resolve every source to a local path before touching the page, so a
      // failed download does not leave a half-filled form behind.
      const files: string[] = [];
      for (const source of sources) {
        const path = await this.resolveToLocalPath(source);
        if (!path) {
          return createErrorResponse(
            `Failed to prepare ${source.fileName || source.fileUrl || 'file'} for upload`,
          );
        }
        files.push(path);
      }

      await cdpSessionManager.withSession(tabId, 'file-upload', async () => {
        await cdpSessionManager.sendCommand(tabId, 'DOM.enable', {});
        await cdpSessionManager.sendCommand(tabId, 'Runtime.enable', {});

        if (mode === 'picker') {
          await this.uploadViaPicker(tabId, args.triggerSelector!, files, args.timeoutMs);
        } else {
          await this.uploadToInput(tabId, args.selector!, files);
        }
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Attached ${files.length} file${files.length === 1 ? '' : 's'}`,
              mode,
              files,
              fileCount: files.length,
              selector: mode === 'picker' ? args.triggerSelector : args.selector,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in file upload operation:', error);
      return createErrorResponse(
        `Error uploading file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Sets files on an input that is already in the DOM. */
  private async uploadToInput(tabId: number, selector: string, files: string[]): Promise<void> {
    const { root } = (await cdpSessionManager.sendCommand(tabId, 'DOM.getDocument', {
      depth: -1,
      pierce: true,
    })) as { root: { nodeId: number } };

    const { nodeId } = (await cdpSessionManager.sendCommand(tabId, 'DOM.querySelector', {
      nodeId: root.nodeId,
      selector,
    })) as { nodeId: number };

    if (!nodeId) throw new Error(`Element with selector "${selector}" not found`);

    await this.assertFileInput(tabId, { nodeId }, selector);
    await cdpSessionManager.sendCommand(tabId, 'DOM.setFileInputFiles', { nodeId, files });
    await this.dispatchChange(tabId, selector);
  }

  /**
   * Clicks a control and answers the file chooser it opens.
   *
   * `Page.setInterceptFileChooser` stops the native dialog from appearing at
   * all — without it the OS picker opens on the user's desktop and blocks
   * until someone dismisses it by hand.
   */
  private async uploadViaPicker(
    tabId: number,
    triggerSelector: string,
    files: string[],
    timeoutMs = DEFAULT_PICKER_TIMEOUT_MS,
  ): Promise<void> {
    await cdpSessionManager.sendCommand(tabId, 'Page.enable', {});
    await cdpSessionManager.sendCommand(tabId, 'Page.setInterceptFileChooser', { enabled: true });

    try {
      const event = await cdpSessionManager.waitForEvent<{
        backendNodeId: number;
        mode: 'selectSingle' | 'selectMultiple';
      }>(
        tabId,
        'Page.fileChooserOpened',
        async () => {
          const clicked = await this.evaluate<boolean>(
            tabId,
            `(() => {
               const element = document.querySelector(${JSON.stringify(triggerSelector)});
               if (!element) return false;
               element.scrollIntoView({ block: 'center' });
               element.click();
               return true;
             })()`,
          );
          if (!clicked) throw new Error(`Trigger "${triggerSelector}" not found`);
        },
        timeoutMs,
      );

      if (event.mode === 'selectSingle' && files.length > 1) {
        throw new Error(
          `The page's file chooser accepts one file, but ${files.length} were provided`,
        );
      }

      await cdpSessionManager.sendCommand(tabId, 'DOM.setFileInputFiles', {
        backendNodeId: event.backendNodeId,
        files,
      });
    } finally {
      // Leaving interception on would swallow the user's own file dialogs in
      // this tab for as long as the debugger stays attached.
      await cdpSessionManager
        .sendCommand(tabId, 'Page.setInterceptFileChooser', { enabled: false })
        .catch(() => {});
    }
  }

  private async assertFileInput(
    tabId: number,
    target: { nodeId: number },
    selector: string,
  ): Promise<void> {
    const { node } = (await cdpSessionManager.sendCommand(tabId, 'DOM.describeNode', target)) as {
      node: { nodeName: string; attributes?: string[] };
    };

    if (node.nodeName !== 'INPUT') {
      throw new Error(`Element with selector "${selector}" is not an input element`);
    }

    const attributes = node.attributes || [];
    for (let i = 0; i < attributes.length; i += 2) {
      if (attributes[i] === 'type' && attributes[i + 1] === 'file') return;
    }
    throw new Error(`Element with selector "${selector}" is not a file input (type="file")`);
  }

  /**
   * Fires `input` then `change`.
   *
   * React and Vue forms hang their validation off these, and an input whose
   * files change without them looks empty to the page. The selector goes
   * through JSON.stringify rather than string concatenation: a selector
   * containing a quote used to break the expression, and anything a caller
   * controls that lands in an eval is worth escaping properly.
   */
  private async dispatchChange(tabId: number, selector: string): Promise<void> {
    await this.evaluate(
      tabId,
      `(() => {
         const element = document.querySelector(${JSON.stringify(selector)});
         if (!element) return false;
         element.dispatchEvent(new Event('input', { bubbles: true }));
         element.dispatchEvent(new Event('change', { bubbles: true }));
         return true;
       })()`,
    );
  }

  private async evaluate<T = unknown>(tabId: number, expression: string): Promise<T> {
    const response = (await cdpSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          'Evaluation failed',
      );
    }
    return response.result?.value as T;
  }

  /** A local path is used as-is; a URL or base64 becomes a file in the host's temp dir. */
  private async resolveToLocalPath(source: FileSource): Promise<string | null> {
    if (source.filePath) return source.filePath;
    if (!source.fileUrl && !source.base64Data) return null;
    return this.prepareFileFromRemote({
      fileUrl: source.fileUrl,
      base64Data: source.base64Data,
      fileName: source.fileName || 'uploaded-file',
    });
  }

  /**
   * Asks the native host to materialise a URL or base64 payload on disk.
   */
  private async prepareFileFromRemote(options: {
    fileUrl?: string;
    base64Data?: string;
    fileName: string;
  }): Promise<string | null> {
    const { fileUrl, base64Data, fileName } = options;

    return new Promise((resolve) => {
      const requestId = `file-upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const timeout = setTimeout(() => {
        console.error('File preparation request timed out');
        chrome.runtime.onMessage.removeListener(handleMessage);
        resolve(null);
      }, 30000);

      const handleMessage = (message: any) => {
        if (
          message.type !== 'file_operation_response' ||
          message.responseToRequestId !== requestId
        ) {
          return;
        }
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handleMessage);

        if (message.payload?.success && message.payload?.filePath) {
          resolve(message.payload.filePath);
        } else {
          console.error(
            'Native host failed to prepare file:',
            message.error || message.payload?.error,
          );
          resolve(null);
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);

      chrome.runtime
        .sendMessage({
          type: 'forward_to_native',
          message: {
            type: 'file_operation',
            requestId,
            payload: { action: 'prepareFile', fileUrl, base64Data, fileName },
          },
        })
        .catch((error) => {
          console.error('Error sending message to background:', error);
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(handleMessage);
          resolve(null);
        });
    });
  }
}

/** Accepts the multi-file form and the older single-file arguments alike. */
function collectSources(args: FileUploadToolParams): FileSource[] {
  if (args.files?.length) return args.files;
  if (args.filePath || args.fileUrl || args.base64Data) {
    return [
      {
        filePath: args.filePath,
        fileUrl: args.fileUrl,
        base64Data: args.base64Data,
        fileName: args.fileName,
      },
    ];
  }
  return [];
}

export const fileUploadTool = new FileUploadTool();
