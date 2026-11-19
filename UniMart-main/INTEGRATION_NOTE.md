# UniMart & UniGram Messaging Integration Note

Please refer to the comprehensive integration guide in the root workspace folder: [UNIGRAM_INTEGRATION_GUIDE.md](../UNIGRAM_INTEGRATION_GUIDE.md)

### Key Frontend Files:
- **`src/api/unigramApi.js`**: Client for UniGram Core Java HTTP REST backend.
- **`src/context/ChatContext.jsx`**: State manager synchronizing UI with Java ChatRoom and polling for background bot messages.
- **`src/components/chat/ChatModal.jsx`**: Chat modal with UniGram status pill, thread tags (`🧵 Thread-User-...`), simulated peer quick action, and disk file inspector.
- **`src/components/chat/Chat.css`**: Styles for UniGram badges, thread concurrency pills, and terminal log viewer.
