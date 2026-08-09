import { MessageTarget } from '@/common/message-types';
import { handleGifMessage } from './gif-encoder';
import { initKeepalive } from './keepalive';

// Keeps the Record-Replay V3 engine alive while a run is in flight.
initKeepalive();

interface OffscreenMessage {
  target: MessageTarget | string;
  type: string;
}

type MessageResponse = {
  result?: string;
  error?: string;
  success?: boolean;
};

/**
 * The offscreen document exists for work the service worker cannot do itself:
 * GIF encoding, and keeping a run alive across service-worker suspension.
 *
 * It previously also hosted an ONNX embedding model for semantic tab search.
 * That subsystem was removed in this fork — see DECISIONS.md.
 */
chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    if (message.target !== MessageTarget.Offscreen) {
      return;
    }

    if (handleGifMessage(message, sendResponse)) {
      return true;
    }

    sendResponse({ error: `Unknown offscreen message type: ${message.type}` });
    return false;
  },
);
