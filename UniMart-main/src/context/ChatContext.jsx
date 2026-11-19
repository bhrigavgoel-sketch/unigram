import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { unigramApi, cleanUserId } from '../api/unigramApi.js';
import { SEEDED_USERS } from '../lib/mockUsers.js';
import { INITIAL_PRODUCTS } from './ListingsContext.jsx';
import { getListingSellerName } from '../lib/constants.js';

const ChatContext = createContext(null);

/**
 * Computes canonical conversation ID for a pair of users.
 * Enforces ONE private conversation per buyer-seller pair.
 */
export function getCanonicalConvId(user1, user2) {
  const u1 = cleanUserId(user1 || '');
  const u2 = cleanUserId(user2 || '');
  const sorted = [u1, u2].sort();
  return `conv_${sorted[0]}_${sorted[1]}`;
}

/**
 * Generates a deterministic stable message identifier.
 * Survives page refreshes, backend syncs, and browser restarts.
 */
export function getStableMessageId(sender, receiver, text, timestamp, productId) {
  const cleanS = cleanUserId(sender || '');
  const cleanR = cleanUserId(receiver || '');
  const cleanT = String(text || '').trim();
  const cleanTime = String(timestamp || '').trim();
  const cleanP = productId ? String(productId).trim() : '';

  let hash = 0;
  const fullStr = `${cleanS}|${cleanR}|${cleanT}|${cleanTime}|${cleanP}`;
  for (let i = 0; i < fullStr.length; i++) {
    const char = fullStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `msg_${cleanS}_${Math.abs(hash).toString(36)}`;
}

/**
 * Merges local and backend messages without duplicates:
 * Matches on stable message ID or (text + timestamp).
 * Preserves 'read' status if locally updated by user.
 */
export function mergeMessages(localMsgs = [], backendMsgs = []) {
  const result = [...localMsgs];

  backendMsgs.forEach((bMsg) => {
    const existingIdx = result.findIndex((m) => {
      if (m.id && bMsg.id && m.id === bMsg.id) return true;
      if (m.text === bMsg.text && m.timestamp === bMsg.timestamp) {
        return true;
      }
      return false;
    });

    if (existingIdx !== -1) {
      const local = result[existingIdx];
      const status = local.status === 'read' ? 'read' : (bMsg.status || local.status || 'delivered');
      result[existingIdx] = {
        ...local,
        ...bMsg,
        id: local.id || bMsg.id,
        status,
        reactions: (local.reactions && local.reactions.length > 0) ? local.reactions : (bMsg.reactions || [])
      };
    } else {
      result.push(bMsg);
    }
  });

  return result;
}

/**
 * Extracts partner ID from a conversation object regardless of legacy schema.
 */
function getPartnerIdFromConv(c, currentUserId) {
  if (!c) return null;
  const pId = cleanUserId(c.participant?.id);
  if (pId && pId !== currentUserId) return pId;

  const sId = cleanUserId(c.sellerId);
  const bId = cleanUserId(c.buyerId);
  if (sId && sId !== currentUserId) return sId;
  if (bId && bId !== currentUserId) return bId;

  if (c.id && c.id.startsWith('conv_')) {
    const parts = c.id.replace('conv_', '').split('_');
    if (parts.length >= 2) {
      if (parts[0] === currentUserId && parts[1]) return parts[1];
      if (parts[1] === currentUserId && parts[0]) return parts[0];
    }
  }
  return null;
}

/**
 * Helper to find a user profile by ID.
 */
export function findUserProfileById(id) {
  if (!id) return { id: '', name: 'Campus Student', avatar: 'S', department: 'Campus Member' };
  const clean = cleanUserId(id);
  const match = (SEEDED_USERS || []).find((u) => cleanUserId(u.id) === clean);
  if (match) {
    return {
      id: clean,
      name: match.name,
      department: match.department || 'Chitkara Campus Member',
      avatar: match.name.charAt(0).toUpperCase()
    };
  }
  return {
    id: clean,
    name: `Student (${clean})`,
    department: 'Campus Member',
    avatar: clean.charAt(0).toUpperCase()
  };
}

/**
 * Consolidates duplicate legacy conversations for the same buyer-seller pair:
 * Merges all messages into ONE conversation per partner without data loss.
 */
export function consolidateConversations(rawList, currentUserId) {
  if (!Array.isArray(rawList) || rawList.length === 0 || !currentUserId) return [];
  const mapByPartner = new Map();

  rawList.forEach((c) => {
    const partnerId = getPartnerIdFromConv(c, currentUserId);
    if (!partnerId || partnerId === currentUserId) return;

    const canonicalId = getCanonicalConvId(currentUserId, partnerId);
    const existing = mapByPartner.get(partnerId);

    // Determine actual listing and seller identity
    const activeListing = c.listing || null;
    let sellerId = partnerId;
    let buyerId = currentUserId;

    if (activeListing && (activeListing.seller_id || activeListing.sellerId)) {
      const actualOwner = cleanUserId(activeListing.seller_id || activeListing.sellerId);
      sellerId = actualOwner;
      buyerId = (actualOwner === currentUserId) ? partnerId : currentUserId;
    } else if (c.sellerId) {
      sellerId = cleanUserId(c.sellerId);
      buyerId = cleanUserId(c.buyerId) || ((sellerId === currentUserId) ? partnerId : currentUserId);
    }

    const partnerProfile = findUserProfileById(partnerId);
    const roleLabel = (sellerId === partnerId) ? 'Seller' : ((sellerId === currentUserId) ? 'Buyer' : 'Student');

    if (!existing) {
      mapByPartner.set(partnerId, {
        ...c,
        id: canonicalId,
        sellerId,
        buyerId,
        participant: {
          ...partnerProfile,
          roleLabel,
          avatarBg: '#70182c',
          online: c.participant?.online ?? true,
          verified: true,
          responseTime: 'Real-time',
          rating: '5.0 ★'
        },
        listing: activeListing,
        lastUpdated: c.lastUpdated || Date.now(),
        unreadCount: c.unreadCount || 0,
        messages: c.messages || []
      });
    } else {
      // Merge duplicate conversation's messages safely without duplicates
      const merged = mergeMessages(existing.messages || [], c.messages || []);
      const mostRecentListing = activeListing || existing.listing;
      const lastUpdated = Math.max(existing.lastUpdated || 0, c.lastUpdated || 0);
      const unreadCount = Math.max(existing.unreadCount || 0, c.unreadCount || 0);

      mapByPartner.set(partnerId, {
        ...existing,
        listing: mostRecentListing,
        lastUpdated,
        unreadCount,
        messages: merged
      });
    }
  });

  return Array.from(mapByPartner.values()).sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
}

export function ChatProvider({ children }) {
  const { user } = useAuth() || {};
  const currentUserId = user?.id ? cleanUserId(user.id) : null;
  const storageKey = currentUserId ? `unimart_chat_convs_${currentUserId}` : 'unimart_chat_guest';

  const [conversations, setConversations] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);

  // Real-time WebSocket connection state
  const [wsConnected, setWsConnected] = useState(false);
  const [unigramConnected, setUnigramConnected] = useState(false);
  const [unigramTelemetry, setUnigramTelemetry] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const isMinimizedRef = useRef(isMinimized);
  isMinimizedRef.current = isMinimized;

  // Active session thread name
  const activeSessionThread = currentUserId ? `Thread-WebSocket-${currentUserId}` : 'Thread-WebSocket-Guest';

  // Helper to find a user profile by ID
  const findUserProfile = useCallback((id) => findUserProfileById(id), []);

  // Synchronize all conversations and complete message histories from Java backend
  const syncAllConversationsFromBackend = useCallback(async () => {
    if (!currentUserId) return;

    try {
      const res = await unigramApi.getConversations(currentUserId);
      if (!res.ok) return;

      const backendConvs = Array.isArray(res.conversations) && res.conversations.length > 0
        ? res.conversations
        : (Array.isArray(res.partners) ? res.partners : []);

      if (backendConvs.length === 0) return;

      // Group backend records by partner to ensure ONE conversation per partner
      const partnersMap = new Map();
      backendConvs.forEach((bConv) => {
        const partnerId = cleanUserId(bConv.partner);
        if (partnerId && partnerId !== currentUserId) {
          if (!partnersMap.has(partnerId)) {
            partnersMap.set(partnerId, bConv);
          }
        }
      });

      // Concurrently fetch complete message history for every unique partner
      const syncPromises = Array.from(partnersMap.entries()).map(async ([partnerId, bConv]) => {
        const msgRes = await unigramApi.getMessages(currentUserId, partnerId, currentUserId);
        const messages = (msgRes.ok && Array.isArray(msgRes.data)) ? msgRes.data : [];

        return {
          partnerId,
          backendSummary: bConv,
          messages
        };
      });

      const fetchedList = (await Promise.all(syncPromises)).filter(Boolean);

      setConversations((prevConvs) => {
        // Consolidate any existing local state to eliminate duplicates
        const updatedList = consolidateConversations(prevConvs, currentUserId);

        fetchedList.forEach(({ partnerId, backendSummary, messages }) => {
          const canonicalId = getCanonicalConvId(currentUserId, partnerId);
          const partnerProfile = findUserProfile(partnerId);

          // Find if there is a referenced product in backend summary or messages
          let refProductId = backendSummary.productId;
          if (!refProductId && messages.length > 0) {
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].productId && !['null', ''].includes(String(messages[i].productId).trim())) {
                refProductId = messages[i].productId;
                break;
              }
            }
          }

          const matchedProduct = refProductId
            ? (INITIAL_PRODUCTS || []).find((p) => String(p.id) === String(refProductId))
            : null;

          // Accurately determine seller and buyer identities
          let sellerId = partnerId;
          let buyerId = currentUserId;

          if (matchedProduct) {
            const actualOwner = cleanUserId(matchedProduct.seller_id || matchedProduct.sellerId);
            sellerId = actualOwner;
            buyerId = (actualOwner === currentUserId) ? partnerId : currentUserId;
          }

          const roleLabel = (sellerId === partnerId) ? 'Seller' : ((sellerId === currentUserId) ? 'Buyer' : 'Student');

          // Convert backend messages using stable IDs
          const formattedBackendMsgs = messages.map((m) => {
            const isMe = cleanUserId(m.sender) === currentUserId;
            const sId = getStableMessageId(m.sender, m.receiver, m.text, m.timestamp, m.productId);
            return {
              id: sId,
              sender: isMe ? 'user' : 'host',
              senderName: isMe ? 'You' : partnerProfile.name,
              timestamp: m.timestamp,
              date: 'Today',
              type: 'text',
              text: m.text,
              threadName: m.threadName || (isMe ? activeSessionThread : `Thread-WebSocket-${m.sender}`),
              status: isMe ? 'delivered' : 'delivered',
              productId: m.productId || refProductId
            };
          });

          // Find existing conversation with this partner
          const existingIdx = updatedList.findIndex((c) => {
            return c.id === canonicalId || getPartnerIdFromConv(c, currentUserId) === partnerId;
          });

          if (existingIdx !== -1) {
            const existingConv = updatedList[existingIdx];
            const isCurrentActive = activeConversationIdRef.current === existingConv.id && isOpenRef.current && !isMinimizedRef.current;

            // Merge messages without duplicates
            const merged = mergeMessages(existingConv.messages || [], formattedBackendMsgs);
            const unread = isCurrentActive ? 0 : (existingConv.unreadCount || 0);

            updatedList[existingIdx] = {
              ...existingConv,
              id: canonicalId,
              sellerId,
              buyerId,
              participant: {
                ...existingConv.participant,
                ...partnerProfile,
                roleLabel,
                online: backendSummary.online !== undefined ? backendSummary.online : existingConv.participant?.online
              },
              listing: existingConv.listing || (matchedProduct ? {
                id: matchedProduct.id,
                title: matchedProduct.title,
                price: matchedProduct.price,
                origPrice: matchedProduct.origPrice,
                condition: matchedProduct.condition || 'Verified',
                image: matchedProduct.image || (matchedProduct.photos && matchedProduct.photos[0]) || null,
                category: matchedProduct.category || 'General',
                meetupSpot: matchedProduct.notes || 'Library Entrance',
                status: 'Available',
                seller_id: sellerId,
                seller: getListingSellerName(matchedProduct),
                sublabel: `${matchedProduct.condition || 'Verified'} • ${matchedProduct.category || 'Item'}`,
                dateLabel: 'Today'
              } : null),
              lastUpdated: Date.now(),
              unreadCount: unread,
              messages: merged
            };
          } else {
            // New conversation from backend not yet in local state
            const isCurrentActive = activeConversationIdRef.current === canonicalId && isOpenRef.current && !isMinimizedRef.current;

            const newConv = {
              id: canonicalId,
              sellerId,
              buyerId,
              participant: {
                id: partnerId,
                name: partnerProfile.name,
                displayName: partnerProfile.name,
                roleLabel,
                badge: partnerProfile.avatar,
                department: partnerProfile.department,
                avatar: partnerProfile.avatar,
                avatarBg: '#70182c',
                online: !!backendSummary.online,
                verified: true,
                responseTime: 'Real-time',
                rating: '5.0 ★'
              },
              listing: matchedProduct ? {
                id: matchedProduct.id,
                title: matchedProduct.title,
                price: matchedProduct.price,
                origPrice: matchedProduct.origPrice,
                condition: matchedProduct.condition || 'Verified',
                image: matchedProduct.image || (matchedProduct.photos && matchedProduct.photos[0]) || null,
                category: matchedProduct.category || 'General',
                meetupSpot: matchedProduct.notes || 'Library Entrance',
                status: 'Available',
                seller_id: sellerId,
                seller: getListingSellerName(matchedProduct),
                sublabel: `${matchedProduct.condition || 'Verified'} • ${matchedProduct.category || 'Item'}`,
                dateLabel: 'Today'
              } : null,
              unreadCount: isCurrentActive ? 0 : (formattedBackendMsgs.length > 0 && formattedBackendMsgs[formattedBackendMsgs.length - 1].sender !== 'user' ? 1 : 0),
              lastUpdated: Date.now(),
              messages: formattedBackendMsgs
            };

            updatedList.unshift(newConv);
          }
        });

        // Set activeConversationId if none is currently selected
        if (!activeConversationIdRef.current && updatedList.length > 0) {
          setActiveConversationId(updatedList[0].id);
        }

        return updatedList;
      });
    } catch (e) {
      console.warn('Failed to sync conversations from Java backend:', e);
    }
  }, [currentUserId, findUserProfile, activeSessionThread]);

  // Load user-scoped conversations from cache and trigger backend sync
  useEffect(() => {
    if (!currentUserId) {
      setConversations([]);
      setActiveConversationId(null);
      return;
    }

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const consolidated = consolidateConversations(parsed, currentUserId);
          setConversations(consolidated);
          if (!activeConversationIdRef.current && consolidated.length > 0) {
            setActiveConversationId(consolidated[0].id);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load user chat cache', e);
    }

    // Automatically load complete conversations and history from Java backend
    syncAllConversationsFromBackend();
  }, [currentUserId, storageKey, syncAllConversationsFromBackend]);

  // Persist conversations to session-scoped localStorage cache
  useEffect(() => {
    if (!currentUserId || conversations.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations));
    } catch (e) {
      console.warn('Failed to save user chat cache', e);
    }
  }, [conversations, currentUserId, storageKey]);

  // Active conversation object
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ||
    (conversations.length > 0 ? conversations[0] : null);

  // Handle incoming WebSocket messages from Java server
  const handleWebSocketMessage = useCallback((payload) => {
    if (!payload || !currentUserId) return;

    if (payload.type === 'new_message') {
      const { senderId, receiverId, text, timestamp, threadName, productId, listingId } = payload;
      const targetProductId = productId || listingId || null;
      const cleanSender = cleanUserId(senderId);
      const cleanReceiver = cleanUserId(receiverId);

      // Verify that this message is intended for current logged-in user
      if (cleanReceiver !== currentUserId) {
        return;
      }

      const senderProfile = findUserProfile(cleanSender);
      const isChatWindowActive = isOpenRef.current && !isMinimizedRef.current;
      const stableMsgId = getStableMessageId(cleanSender, currentUserId, text, timestamp, targetProductId);

      const newMsgObj = {
        id: stableMsgId,
        sender: 'host',
        senderName: senderProfile.name,
        timestamp: timestamp || new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase(),
        date: 'Today',
        type: 'text',
        text: text,
        threadName: threadName || `Thread-WebSocket-${cleanSender}`,
        status: 'delivered',
        productId: targetProductId
      };

      setConversations((prev) => {
        // Enforce ONE conversation per partner
        const canonicalId = getCanonicalConvId(currentUserId, cleanSender);
        const existingIdx = prev.findIndex((c) => {
          return c.id === canonicalId || getPartnerIdFromConv(c, currentUserId) === cleanSender;
        });

        const matchedProduct = targetProductId
          ? (INITIAL_PRODUCTS || []).find((p) => String(p.id) === String(targetProductId))
          : null;

        if (existingIdx !== -1) {
          const targetConv = prev[existingIdx];
          const isCurrentActive = activeConversationIdRef.current === targetConv.id && isChatWindowActive;

          if (isCurrentActive) {
            unigramApi.markRead(wsRef.current, { readerId: currentUserId, senderId: cleanSender, productId: targetProductId });
          }

          const mergedMessages = mergeMessages(targetConv.messages || [], [newMsgObj]);

          // Update active listing if an inquiry for a product arrived
          const updatedListing = matchedProduct ? {
            id: matchedProduct.id,
            title: matchedProduct.title,
            price: matchedProduct.price,
            origPrice: matchedProduct.origPrice,
            condition: matchedProduct.condition || 'Verified',
            image: matchedProduct.image || (matchedProduct.photos && matchedProduct.photos[0]) || null,
            category: matchedProduct.category || 'General',
            meetupSpot: matchedProduct.notes || 'Library Entrance',
            status: 'Available',
            seller_id: cleanUserId(matchedProduct.seller_id || matchedProduct.sellerId),
            seller: getListingSellerName(matchedProduct),
            sublabel: `${matchedProduct.condition || 'Verified'} • ${matchedProduct.category || 'Item'}`,
            dateLabel: 'Today'
          } : targetConv.listing;

          const updatedConv = {
            ...targetConv,
            id: canonicalId,
            listing: updatedListing,
            lastUpdated: Date.now(),
            unreadCount: isCurrentActive ? 0 : (targetConv.unreadCount || 0) + 1,
            messages: mergedMessages
          };

          const remaining = prev.filter((_, i) => i !== existingIdx);
          return [updatedConv, ...remaining];
        } else {
          // Auto-display new conversation in recipient's inbox (ONE conversation per partner)
          const isCurrentActive = activeConversationIdRef.current === canonicalId && isChatWindowActive;

          if (isCurrentActive) {
            unigramApi.markRead(wsRef.current, { readerId: currentUserId, senderId: cleanSender, productId: targetProductId });
          }

          let sellerId = cleanSender;
          let buyerId = currentUserId;
          if (matchedProduct) {
            const actualOwner = cleanUserId(matchedProduct.seller_id || matchedProduct.sellerId);
            sellerId = actualOwner;
            buyerId = (actualOwner === currentUserId) ? cleanSender : currentUserId;
          }
          const roleLabel = (sellerId === cleanSender) ? 'Seller' : ((sellerId === currentUserId) ? 'Buyer' : 'Student');

          const newConv = {
            id: canonicalId,
            sellerId,
            buyerId,
            participant: {
              id: cleanSender,
              name: senderProfile.name,
              displayName: senderProfile.name,
              roleLabel,
              badge: senderProfile.avatar,
              department: senderProfile.department,
              avatar: senderProfile.avatar,
              avatarBg: '#70182c',
              online: true,
              verified: true,
              responseTime: 'Real-time',
              rating: '5.0 ★'
            },
            listing: matchedProduct ? {
              id: matchedProduct.id,
              title: matchedProduct.title,
              price: matchedProduct.price,
              origPrice: matchedProduct.origPrice,
              condition: matchedProduct.condition || 'Verified',
              image: matchedProduct.image || (matchedProduct.photos && matchedProduct.photos[0]) || null,
              category: matchedProduct.category || 'General',
              meetupSpot: matchedProduct.notes || 'Library Entrance',
              status: 'Available',
              seller_id: sellerId,
              seller: getListingSellerName(matchedProduct),
              sublabel: `${matchedProduct.condition || 'Verified'} • ${matchedProduct.category || 'Item'}`,
              dateLabel: 'Today'
            } : null,
            unreadCount: isCurrentActive ? 0 : 1,
            lastUpdated: Date.now(),
            messages: [newMsgObj]
          };

          return [newConv, ...prev];
        }
      });
    } else if (payload.type === 'message_delivered') {
      const { text, timestamp, threadName, deliveredToOnlinePeer, productId, listingId } = payload;
      const targetProductId = productId || listingId || null;
      const targetStatus = deliveredToOnlinePeer ? 'delivered' : 'sent';

      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          messages: (c.messages || []).map((m) => {
            if (m.sender === 'user' && m.text === text && m.status !== 'read') {
              return {
                ...m,
                status: targetStatus,
                timestamp: timestamp || m.timestamp,
                threadName: threadName || m.threadName,
                productId: targetProductId || m.productId
              };
            }
            return m;
          })
        }))
      );
    } else if (payload.type === 'messages_read') {
      const { readerId } = payload;
      const cleanReader = cleanUserId(readerId);

      setConversations((prev) =>
        prev.map((c) => {
          const partner = getPartnerIdFromConv(c, currentUserId);
          if (partner !== cleanReader) return c;
          return {
            ...c,
            messages: (c.messages || []).map((m) => {
              if (m.sender === 'user') {
                return {
                  ...m,
                  status: 'read'
                };
              }
              return m;
            })
          };
        })
      );
    }
  }, [currentUserId, findUserProfile]);

  // Connect to UniGram WebSocket Server with auto-reconnection
  useEffect(() => {
    if (!currentUserId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      setUnigramConnected(false);
      return;
    }

    let isMounted = true;

    function connect() {
      if (!isMounted || !currentUserId) return;

      const ws = unigramApi.connectWebSocket(currentUserId, {
        onOpen: () => {
          if (!isMounted) return;
          setWsConnected(true);
          setUnigramConnected(true);
          // Register with Java backend
          unigramApi.login(currentUserId);
          // Synchronize complete conversations & missed messages after connecting/reconnecting
          syncAllConversationsFromBackend();
        },
        onMessage: (data) => {
          if (!isMounted) return;
          handleWebSocketMessage(data);
        },
        onClose: () => {
          if (!isMounted) return;
          setWsConnected(false);
          // Auto reconnect after 2.5s backoff
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (isMounted && currentUserId) {
              connect();
            }
          }, 2500);
        },
        onError: () => {
          if (!isMounted) return;
          setWsConnected(false);
        }
      });

      wsRef.current = ws;
    }

    connect();

    // Check status for telemetry
    unigramApi.checkStatus().then((res) => {
      if (isMounted && res.isOnline) {
        setUnigramConnected(true);
        setUnigramTelemetry(res);
      }
    });

    const statusInterval = setInterval(() => {
      unigramApi.checkStatus().then((res) => {
        if (isMounted) {
          setUnigramConnected(res.isOnline);
          if (res.isOnline) setUnigramTelemetry(res);
        }
      });
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(statusInterval);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUserId, handleWebSocketMessage, syncAllConversationsFromBackend]);

  // Periodic background synchronization to guard against missed socket events
  useEffect(() => {
    if (!currentUserId) return;
    const interval = setInterval(() => {
      syncAllConversationsFromBackend();
    }, 8000);
    return () => clearInterval(interval);
  }, [currentUserId, syncAllConversationsFromBackend]);

  // Sync complete conversation history for an individual partner
  const syncHistoryForPartner = useCallback(async (partnerId) => {
    const cleanPartner = cleanUserId(partnerId);
    if (!cleanPartner || !currentUserId || cleanPartner === currentUserId) return;

    const res = await unigramApi.getMessages(currentUserId, cleanPartner, currentUserId);
    if (res.ok && Array.isArray(res.data)) {
      setConversations((prev) => {
        const canonicalId = getCanonicalConvId(currentUserId, cleanPartner);
        return prev.map((c) => {
          if (c.id !== canonicalId && getPartnerIdFromConv(c, currentUserId) !== cleanPartner) {
            return c;
          }

          const partnerProfile = findUserProfile(cleanPartner);
          const formattedBackendMsgs = res.data.map((m) => {
            const isMe = cleanUserId(m.sender) === currentUserId;
            const sId = getStableMessageId(m.sender, m.receiver, m.text, m.timestamp, m.productId);
            return {
              id: sId,
              sender: isMe ? 'user' : 'host',
              senderName: isMe ? 'You' : (partnerProfile.name || m.sender),
              timestamp: m.timestamp,
              date: 'Today',
              type: 'text',
              text: m.text,
              threadName: m.threadName || (isMe ? activeSessionThread : `Thread-WebSocket-${m.sender}`),
              status: isMe ? 'delivered' : 'delivered',
              productId: m.productId
            };
          });

          const merged = mergeMessages(c.messages || [], formattedBackendMsgs);
          return {
            ...c,
            lastUpdated: Date.now(),
            messages: merged
          };
        });
      });
    }
  }, [currentUserId, activeSessionThread, findUserProfile]);

  // Notify server and peer that current user has read messages from this partner
  const notifyConversationReadByPartner = useCallback((partnerId) => {
    const cleanPartner = cleanUserId(partnerId);
    if (!cleanPartner || !currentUserId || !wsRef.current) return;
    if (cleanPartner !== currentUserId) {
      unigramApi.markRead(wsRef.current, { readerId: currentUserId, senderId: cleanPartner });
    }
  }, [currentUserId]);

  // Total unread count
  const unreadTotal = conversations.reduce((acc, conv) => acc + (conv.unreadCount || 0), 0);

  // Mark conversation as read
  const markAsRead = (convId) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === convId && c.unreadCount > 0) {
          return { ...c, unreadCount: 0 };
        }
        return c;
      })
    );
    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      const partnerId = getPartnerIdFromConv(conv, currentUserId);
      if (partnerId) {
        notifyConversationReadByPartner(partnerId);
      }
    }
  };

  // Open chat directly for a specific item (Consolidates all items by the same seller into ONE conversation)
  const openChatWithItem = (item) => {
    if (!item || !currentUserId) return;

    // 1. Identify actual seller from the item's seller_id
    let actualSellerId = cleanUserId(item.seller_id || item.sellerId || item.ownerId);
    if (!actualSellerId && item.seller) {
      const match = (SEEDED_USERS || []).find(
        (u) => u.name && item.seller.toLowerCase().includes(u.name.toLowerCase().split(' ')[0])
      );
      if (match) actualSellerId = cleanUserId(match.id);
    }
    if (!actualSellerId) actualSellerId = `seller_${item.id}`;

    // Cannot start a chat with oneself
    if (actualSellerId === currentUserId) {
      alert('This is your own listing.');
      return;
    }

    const canonicalId = getCanonicalConvId(currentUserId, actualSellerId);
    const sellerProfile = findUserProfile(actualSellerId);

    const productObj = {
      id: item.id,
      title: item.title,
      price: item.price,
      origPrice: item.origPrice,
      condition: item.condition || 'Verified',
      image: item.image || (item.photos && item.photos[0]) || null,
      category: item.category || 'General',
      meetupSpot: item.notes || item.pickupSpot || item.meetupSpot || 'Library Entrance',
      status: 'Available',
      seller_id: actualSellerId,
      seller: getListingSellerName(item),
      sublabel: `${item.condition || 'Verified'} • ${item.category || 'Item'}`,
      dateLabel: 'Today'
    };

    setConversations((prev) => {
      // Look for existing conversation with this seller
      const existingIdx = prev.findIndex((c) => {
        return c.id === canonicalId || getPartnerIdFromConv(c, currentUserId) === actualSellerId;
      });

      if (existingIdx !== -1) {
        // Same conversation is reused! Updates active product enquiry without creating duplicates
        const targetConv = prev[existingIdx];
        const updatedConv = {
          ...targetConv,
          id: canonicalId,
          sellerId: actualSellerId,
          buyerId: currentUserId,
          listing: productObj, // Links this product to the conversation!
          participant: {
            ...targetConv.participant,
            ...sellerProfile,
            roleLabel: 'Seller'
          },
          unreadCount: 0
        };

        const remaining = prev.filter((_, i) => i !== existingIdx);
        return [updatedConv, ...remaining];
      } else {
        // First-time conversation with this seller
        const newConversation = {
          id: canonicalId,
          sellerId: actualSellerId,
          buyerId: currentUserId,
          participant: {
            id: actualSellerId,
            name: sellerProfile.name,
            displayName: sellerProfile.name,
            roleLabel: 'Seller',
            badge: sellerProfile.avatar,
            department: sellerProfile.department,
            avatar: sellerProfile.avatar,
            avatarBg: '#70182c',
            online: true,
            verified: true,
            responseTime: '15 mins',
            rating: '4.9 ★ (Verified Student)'
          },
          listing: productObj,
          unreadCount: 0,
          lastUpdated: Date.now(),
          messages: []
        };
        return [newConversation, ...prev];
      }
    });

    setActiveConversationId(canonicalId);
    setIsOpen(true);
    setIsMinimized(false);

    syncHistoryForPartner(actualSellerId);
    notifyConversationReadByPartner(actualSellerId);
  };

  // Open Direct Chat with a partner (Reuses the ONE conversation for this user pair)
  const openDirectChat = (partnerId) => {
    const cleanPartner = cleanUserId(partnerId);
    if (!cleanPartner || !currentUserId || cleanPartner === currentUserId) return;

    const canonicalId = getCanonicalConvId(currentUserId, cleanPartner);
    const partnerProfile = findUserProfile(cleanPartner);

    setConversations((prev) => {
      const existingIdx = prev.findIndex((c) => {
        return c.id === canonicalId || getPartnerIdFromConv(c, currentUserId) === cleanPartner;
      });

      if (existingIdx !== -1) {
        const targetConv = prev[existingIdx];
        const updatedConv = {
          ...targetConv,
          id: canonicalId,
          unreadCount: 0
        };
        const remaining = prev.filter((_, i) => i !== existingIdx);
        return [updatedConv, ...remaining];
      } else {
        const newConversation = {
          id: canonicalId,
          sellerId: cleanPartner,
          buyerId: currentUserId,
          participant: {
            id: cleanPartner,
            name: partnerProfile.name,
            displayName: partnerProfile.name,
            roleLabel: 'Student',
            badge: partnerProfile.avatar,
            department: partnerProfile.department,
            avatar: partnerProfile.avatar,
            avatarBg: '#70182c',
            online: true,
            verified: true,
            responseTime: 'Real-time',
            rating: '5.0 ★'
          },
          listing: null,
          unreadCount: 0,
          lastUpdated: Date.now(),
          messages: []
        };
        return [newConversation, ...prev];
      }
    });

    setActiveConversationId(canonicalId);
    setIsOpen(true);
    setIsMinimized(false);

    syncHistoryForPartner(cleanPartner);
    notifyConversationReadByPartner(cleanPartner);
  };

  const openConversation = (convId) => {
    setActiveConversationId(convId);
    markAsRead(convId);
    setIsOpen(true);
    setIsMinimized(false);

    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      const partnerId = getPartnerIdFromConv(conv, currentUserId);
      if (partnerId) {
        syncHistoryForPartner(partnerId);
        notifyConversationReadByPartner(partnerId);
      }
    }
  };

  // Sync read status when active chat opens
  useEffect(() => {
    if (isOpen && !isMinimized && activeConversation) {
      const partnerId = getPartnerIdFromConv(activeConversation, currentUserId);
      if (partnerId) {
        notifyConversationReadByPartner(partnerId);
      }
    }
  }, [isOpen, isMinimized, activeConversation, currentUserId, notifyConversationReadByPartner]);

  const openInbox = () => {
    setIsOpen(true);
    setIsMinimized(false);
    syncAllConversationsFromBackend();
  };

  const closeChat = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const toggleChat = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        syncAllConversationsFromBackend();
      }
      return next;
    });
    setIsMinimized(false);
  };

  const toggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  // SEND MESSAGE: Dispatches real-time WebSocket frame to recipient's active session
  const sendMessage = async (text) => {
    if (!activeConversationId || !text || !text.trim() || !currentUserId) return;

    const currentConv = conversations.find((c) => c.id === activeConversationId);
    if (!currentConv) return;

    const targetReceiverId = getPartnerIdFromConv(currentConv, currentUserId);
    const productId = currentConv.listing?.id ? String(currentConv.listing.id) : null;

    if (!targetReceiverId) {
      alert('Error: Recipient could not be identified.');
      return;
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    const stableId = getStableMessageId(currentUserId, targetReceiverId, text.trim(), timeStr, productId);

    const userMsg = {
      id: stableId,
      sender: 'user',
      senderName: 'You',
      timestamp: timeStr,
      date: 'Today',
      type: 'text',
      text: text.trim(),
      threadName: activeSessionThread,
      status: 'sent',
      productId: productId
    };

    // Optimistically update conversation state
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === activeConversationId) {
          const updatedMsgs = mergeMessages(c.messages || [], [userMsg]);
          return {
            ...c,
            lastUpdated: Date.now(),
            messages: updatedMsgs
          };
        }
        return c;
      })
    );

    // Deliver via WebSocket
    const sentOverWs = unigramApi.sendWebSocketMessage(wsRef.current, {
      senderId: currentUserId,
      receiverId: targetReceiverId,
      text: text.trim(),
      listingId: productId,
      productId: productId
    });

    // Fallback to HTTP if WebSocket is not currently open
    if (!sentOverWs) {
      try {
        await unigramApi.sendHttpMessage({
          senderId: currentUserId,
          receiverId: targetReceiverId,
          text: text.trim(),
          productId: productId,
          listingId: productId
        });
      } catch (err) {
        console.warn('[UniGram] HTTP fallback failed:', err);
      }
    }
  };

  // Toggle reaction on a message
  const toggleReaction = (messageId, emoji) => {
    if (!activeConversationId) return;

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === activeConversationId) {
          return {
            ...c,
            messages: (c.messages || []).map((m) => {
              if (m.id === messageId) {
                const current = m.reactions || [];
                const hasEmoji = current.includes(emoji);
                const next = hasEmoji ? current.filter((e) => e !== emoji) : [...current, emoji];
                return { ...m, reactions: next };
              }
              return m;
            })
          };
        }
        return c;
      })
    );
  };

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeConversation,
        activeConversationId,
        isOpen,
        isMinimized,
        unreadTotal,
        openChatWithItem,
        openDirectChat,
        openConversation,
        openInbox,
        closeChat,
        toggleChat,
        toggleMinimize,
        sendMessage,
        toggleReaction,
        syncAllConversationsFromBackend,
        // UniGram Core Java & WebSocket extensions
        wsConnected,
        unigramConnected,
        unigramTelemetry,
        activeSessionThread,
        currentUserId
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

export default ChatContext;
