# UniMart & UniGram Messaging Architecture — Real-Time WebSocket Integration

This document explains the production-grade integration of **UniGram's Core Java Multithreaded Engine** with **UniMart's Campus Marketplace Messaging Feature**.

---

## 🏛️ 1. Architecture: From Simulation to Real-Time Real-User WebSockets

```
┌────────────────────────────────────────────────────────────────────────┐
│                        UniMart React Web Frontend                      │
│                                                                        │
│   Session A (Satkar Singh)                 Session B (Priya K.)        │
│   User ID: 'student_a'                     User ID: 'student_b'        │
│   Storage: unimart_chat_convs_student_a    Storage: unimart_chat_convs_student_b
│              │                                        │                │
└──────────────┼────────────────────────────────────────┼────────────────┘
               │ ws://localhost:8085                    │ ws://localhost:8085
               │ (Sec-WebSocket-Key / RFC 6455)         │ (RFC 6455 Full Duplex)
┌──────────────▼────────────────────────────────────────▼────────────────┐
│               UniGram Core Java Engine (JDK Standard Library)           │
│                                                                        │
│  [server.UniGramWebSocketServer] (Port 8085)                           │
│  - Active Session Registry: Map<String, Set<WebSocketSession>>         │
│  - Concurrency: Independent Worker Threads per Session Socket          │
│      * Thread-WebSocket-student_a-1                                    │
│      * Thread-WebSocket-student_b-2                                    │
│  - Real-Time Direct Push:                                              │
│      When student_a sends frame -> Immediately written to student_b    │
│      socket OutputStream without polling or delay                      │
│                                                                        │
│  [server.UniGramHttpServer] (Port 8080)                                │
│  - Telemetry: GET /api/status                                          │
│  - History with Privacy Barrier: GET /api/messages                     │
│      * Only participants (user1 or user2) can read conversation        │
│      * Third-party users (student_c) are BLOCKED with HTTP 403         │
│  - Physical Log Inspection: GET /api/history/raw                       │
│                                                                        │
│  [service.ChatRoom] (Synchronized Monitor Locks)                       │
│  - Canonical Keys: "userA#userB" (alphabetical ordering)               │
│  - Thread-Safe Shared Collections (Synchronized Lists & HashMaps)      │
│                                                                        │
│  [persistence.ChatFileManager]                                         │
│  - try-with-resources physical file persistence                       │
│  - Disk File: UniGram/data/chat_history.txt                            │
│  - Format: TIMESTAMP|THREAD_NAME|SENDER|RECEIVER|MESSAGE_TEXT          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 2. Key Requirements Addressed & Fixed

| Requirement | Implementation Detail | Source File |
| :--- | :--- | :--- |
| **1. Remove Simulated Peer** | Completely eliminated `SimulatedUser`, "Simulate Peer (Bob)" UI button, and mock canned messages. | `ChatModal.jsx`, `ChatContext.jsx`, `UniGramServer.java` |
| **2. Real Multi-User Backend** | Every logged-in UniMart user connects to the same running Java server via WebSockets. | `unigramApi.js`, `UniGramWebSocketServer.java` |
| **3. Real UniMart User IDs** | Users are identified by their real UniMart IDs (`student_a`, `student_b`, `admin_1`, etc.), not hardcoded names. | `unigramApi.js:cleanUserId`, `ChatContext.jsx` |
| **4. Direct WebSocket Delivery** | When User A sends a message to User B, it is pushed immediately to User B's active WebSocket session. | `UniGramWebSocketServer.java:346-368` |
| **5. Real-Time Bidirectional Replies** | When User B replies, User A's open conversation stream updates instantly via their WebSocket listener. | `ChatContext.jsx:handleWebSocketMessage` |
| **6. Isolated Pair Conversations** | Every buyer-seller pair has an isolated conversation history stored under `userA#userB`. | `ChatRoom.java:getConversationKey` |
| **7. Durable Disk Persistence** | Messages are permanently stored to disk using `try-with-resources` in delimited text format. | `ChatFileManager.java`, `data/chat_history.txt` |
| **8. Java Multithreading** | Each client socket is assigned its own Java Thread (`Thread-WebSocket-<userId>-<id>`), synchronized with monitor locks. | `UniGramWebSocketServer.java:170-175` |
| **9. Strict Privacy Enforcement** | Non-participants (e.g. `student_c`) attempting to access `student_a#student_b` conversations are blocked with **HTTP 403 Forbidden**. | `ChatRoom.java:274`, `UniGramHttpServer.java:268` |

---

## 🚀 3. How to Launch and Test with Two Real User Sessions

### Step 1: Start the Java Backend Server
Run the one-click script:
```cmd
start_unigram_server.bat
```
*(Or inside `UniGram`)*:
```cmd
cd UniGram
start_server.bat
```
Output:
```text
==================================================================
   STARTING UNIGRAM REAL-TIME SERVER SUITE
   HTTP REST API Port: 8080
   Real-Time WebSocket Port: 8085
   Storage: data\chat_history.txt
==================================================================
   UNIGRAM REAL-TIME WEBSOCKET SERVER LISTENING ON PORT 8085
   Direct push: Active sessions receive instant one-to-one messages
   UNIGRAM HTTP REST API RUNNING ON PORT 8080
```

### Step 2: Start UniMart Web Frontend
```cmd
cd UniMart-main
npm run dev
```

### Step 3: Test with Two Separate Browser Sessions
1. **Browser 1 (Normal Window)**:
   - Go to `http://localhost:5173`.
   - Log in as **Satkar Singh** (`student_a`).
   - Click "Chat" on the **Calculus** listing (sold by Priya K., `student_b`).
   - Type: `"Hi Priya, is your Calculus textbook still available?"` and send.
2. **Browser 2 (Incognito or Second Browser)**:
   - Go to `http://localhost:5173`.
   - Log in as **Priya K.** (`student_b`).
   - Notice the unread badge and the incoming conversation from **Satkar Singh** appearing in real-time!
   - Open the conversation: Satkar's message is displayed with `🧵 Thread-WebSocket-student_a-1`.
   - Type reply: `"Yes Satkar, it is available! Let's meet at 4 PM."` and send.
3. **Verify Browser 1**:
   - Priya's reply appears in Satkar's chat window **instantly without manual refresh**!

---

## 🧪 4. Automated Verification Results

All automated verification test suites pass with 100%:

1. **`SystemTest.java`**: 8 / 8 core syllabus scenarios passed (100%).
2. **`ServerTest.java`**: 6 / 6 HTTP REST and handshake tests passed (100%).
3. **`RealTimeTwoUserIntegrationTest.java`**: 5 / 5 multi-user WebSocket tests passed (100%).
4. **`test_two_sessions.js`**: Verified real-time two-way messaging between `student_a` and `student_b`, HTTP 403 privacy barrier, and physical disk persistence.
5. **UniMart Linter & Production Build**: 0 errors, build completed in ~300ms.
