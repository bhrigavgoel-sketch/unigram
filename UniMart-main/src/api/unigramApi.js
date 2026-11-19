// src/api/unigramApi.js
/**
 * UNIGRAM Core Java Engine API & WebSocket Client
 * 
 * Bridges UniMart campus marketplace with the UniGram Core Java backend:
 * - Real-time full-duplex WebSocket communication on ws://localhost:8085
 * - HTTP REST API on http://localhost:8080 for history and status
 * - Pure user ID identification (student_a, student_b, admin_1, etc.)
 * - Zero simulated peers or mock names
 */

const DEFAULT_HTTP_URL = 'http://localhost:8080';
const DEFAULT_WS_URL = 'ws://localhost:8085';

export const UNIGRAM_HTTP_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_UNIGRAM_API_URL)
  ? import.meta.env.VITE_UNIGRAM_API_URL
  : DEFAULT_HTTP_URL;

export const UNIGRAM_WS_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_UNIGRAM_WS_URL)
  ? import.meta.env.VITE_UNIGRAM_WS_URL
  : DEFAULT_WS_URL;

/**
 * Sanitizes an actual UniMart user ID into a valid identifier:
 * Preserves exact ID (e.g. 'student_a', 'student_b', 'admin_1', 'student_17318...').
 */
export function cleanUserId(id) {
  if (!id) return '';
  return String(id).trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Short timeout fetch to avoid freezing if Java backend is offline.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export const unigramApi = {
  httpUrl: UNIGRAM_HTTP_URL,
  wsUrl: UNIGRAM_WS_URL,

  /**
   * Health check for HTTP REST & WebSocket port telemetry.
   */
  async checkStatus() {
    try {
      const res = await fetchWithTimeout(`${UNIGRAM_HTTP_URL}/api/status`, { method: 'GET' }, 1500);
      if (!res.ok) {
        return { isOnline: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { isOnline: true, ...data };
    } catch (_e) {
      return { isOnline: false, error: 'Connection refused' };
    }
  },

  /**
   * Registers/resumes a real user session in Java backend.
   */
  async login(userId) {
    const validId = cleanUserId(userId);
    if (!validId) return { ok: false, error: 'Invalid user ID' };

    try {
      const res = await fetchWithTimeout(`${UNIGRAM_HTTP_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: validId })
      }, 2500);
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /**
   * Retrieves conversation partners and product-specific conversation summaries for an authenticated user with privacy enforcement.
   */
  async getConversations(userId) {
    const validId = cleanUserId(userId);
    if (!validId) return { ok: false, conversations: [], partners: [], data: [] };

    try {
      const url = `${UNIGRAM_HTTP_URL}/api/conversations?userId=${encodeURIComponent(validId)}`;
      const res = await fetchWithTimeout(url, { method: 'GET' }, 2500);
      if (!res.ok) return { ok: false, conversations: [], partners: [], data: [] };
      const data = await res.json();
      const convList = Array.isArray(data.conversations) ? data.conversations : [];
      const partList = Array.isArray(data.partners) ? data.partners : [];
      return {
        ok: true,
        conversations: convList,
        partners: partList,
        data: convList.length > 0 ? convList : partList
      };
    } catch (_e) {
      return { ok: false, conversations: [], partners: [], data: [] };
    }
  },

  /**
   * Retrieves chronological messages between two participants for a specific product with strict privacy check.
   */
  async getMessages(user1, user2, requesterId, productId) {
    const u1 = cleanUserId(user1);
    const u2 = cleanUserId(user2);
    const req = cleanUserId(requesterId || user1);

    if (!u1 || !u2) return { ok: false, messages: [] };

    try {
      let url = `${UNIGRAM_HTTP_URL}/api/messages?user1=${encodeURIComponent(u1)}&user2=${encodeURIComponent(u2)}&requester=${encodeURIComponent(req)}`;
      if (productId) {
        url += `&productId=${encodeURIComponent(productId)}`;
      }
      const res = await fetchWithTimeout(url, { method: 'GET' }, 2500);
      if (!res.ok) {
        if (res.status === 403) {
          console.warn('[UniGram Privacy] Access Denied: User is not a participant in this conversation.');
        }
        return { ok: false, status: res.status, messages: [] };
      }
      const data = await res.json();
      return { ok: true, status: 200, data: data.messages || [] };
    } catch (_e) {
      return { ok: false, messages: [] };
    }
  },

  /**
   * Fallback HTTP message dispatch (if WebSocket temporarily unavailable).
   */
  async sendHttpMessage({ senderId, receiverId, text, productId, listingId }) {
    const sId = cleanUserId(senderId);
    const rId = cleanUserId(receiverId);
    const pId = productId || listingId || null;

    try {
      const res = await fetchWithTimeout(`${UNIGRAM_HTTP_URL}/api/messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: sId,
          receiverId: rId,
          text: text.trim(),
          productId: pId,
          listingId: pId
        })
      }, 3000);

      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /**
   * Connects to UniGram real-time WebSocket server using actual UniMart user ID.
   */
  connectWebSocket(userId, { onMessage, onOpen, onClose, onError }) {
    const validId = cleanUserId(userId);
    if (!validId) return null;

    try {
      const url = `${UNIGRAM_WS_URL}/ws?userId=${encodeURIComponent(validId)}`;
      const ws = new WebSocket(url);

      ws.onopen = (event) => {
        if (onOpen) onOpen(event);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (onMessage) onMessage(parsed);
        } catch (_err) {
          console.warn('[WebSocket Parse Warning]', event.data);
        }
      };

      ws.onclose = (event) => {
        if (onClose) onClose(event);
      };

      ws.onerror = (event) => {
        if (onError) onError(event);
      };

      return ws;
    } catch (err) {
      console.warn('[WebSocket Init Error]', err);
      return null;
    }
  },

  /**
   * Sends a message over the open WebSocket to the Java backend.
   */
  sendWebSocketMessage(ws, { senderId, receiverId, text, listingId, productId }) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const pId = productId || listingId || null;

    const payload = {
      type: 'send_message',
      senderId: cleanUserId(senderId),
      receiverId: cleanUserId(receiverId),
      text: text.trim(),
      productId: pId,
      listingId: pId
    };

    ws.send(JSON.stringify(payload));
    return true;
  },

  /**
   * Sends mark_read event to inform server and sender that reader opened/viewed conversation.
   */
  markRead(ws, { readerId, senderId, productId, listingId }) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const pId = productId || listingId || null;

    const payload = {
      type: 'mark_read',
      readerId: cleanUserId(readerId),
      senderId: cleanUserId(senderId),
      productId: pId,
      listingId: pId
    };

    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (_e) {
      return false;
    }
  },

  /**
   * Reads raw physical disk log (chat_history.txt) from the Java backend.
   */
  async getRawHistory() {
    try {
      const res = await fetchWithTimeout(`${UNIGRAM_HTTP_URL}/api/history/raw`, { method: 'GET' }, 2500);
      if (!res.ok) return { ok: false, raw: '[Unable to read file]' };
      const data = await res.json();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
};

export default unigramApi;
