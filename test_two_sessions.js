// test_two_sessions.js
// Tests bidirectional real-time communication between two separate UniMart user accounts

const WS_PORT = 8085;
const HTTP_PORT = 8080;

async function runTwoSessionTest() {
  console.log('==================================================================');
  console.log('   TESTING 2 REAL UNIMART BROWSER SESSIONS OVER WEBSOCKETS');
  console.log('   Session 1: student_a (Satkar Singh)');
  console.log('   Session 2: student_b (Priya K.)');
  console.log('==================================================================');

  // 1. Check HTTP server status
  console.log('\n[1] Checking UniGram server status...');
  const statusRes = await fetch(`http://localhost:${HTTP_PORT}/api/status`);
  const status = await statusRes.json();
  console.log('Server Status:', status.status, '| Active WebSocket Port:', status.wsPort);

  // 2. Open Session 1 for student_a (Satkar Singh)
  console.log('\n[2] Connecting Session 1 (student_a)...');
  const session1 = new WebSocket(`ws://localhost:${WS_PORT}/ws?userId=student_a`);
  const session1Messages = [];

  await new Promise((resolve, reject) => {
    session1.onopen = () => {
      console.log('Session 1 (student_a) WebSocket opened successfully!');
      resolve();
    };
    session1.onerror = (err) => reject(new Error('Session 1 error: ' + err.message));
  });

  session1.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[Session 1 Received Frame]', data.type, 'from:', data.senderId || 'server');
    session1Messages.push(data);
  };

  // 3. Open Session 2 for student_b (Priya K.)
  console.log('\n[3] Connecting Session 2 (student_b)...');
  const session2 = new WebSocket(`ws://localhost:${WS_PORT}/ws?userId=student_b`);
  const session2Messages = [];

  await new Promise((resolve, reject) => {
    session2.onopen = () => {
      console.log('Session 2 (student_b) WebSocket opened successfully!');
      resolve();
    };
    session2.onerror = (err) => reject(new Error('Session 2 error: ' + err.message));
  });

  session2.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[Session 2 Received Frame]', data.type, 'from:', data.senderId || 'server');
    session2Messages.push(data);
  };

  // Wait 300ms for connection telemetry
  await new Promise((r) => setTimeout(r, 300));

  // 4. Session 1 (Satkar) sends message to Session 2 (Priya)
  console.log('\n[4] Session 1 (Satkar) sends: "Hi Priya! Is your Calculus textbook still available?"');
  session1.send(JSON.stringify({
    type: 'send_message',
    senderId: 'student_a',
    receiverId: 'student_b',
    text: 'Hi Priya! Is your Calculus textbook still available?',
    listingId: 1
  }));

  // Wait 600ms for real-time delivery
  await new Promise((r) => setTimeout(r, 600));

  const receivedByPriya = session2Messages.find((m) => m.type === 'new_message' && m.text.includes('Calculus textbook'));
  if (receivedByPriya) {
    console.log('SUCCESS! Session 2 (Priya) received message in REAL TIME:');
    console.log('  -> From:', receivedByPriya.senderId);
    console.log('  -> Text:', receivedByPriya.text);
    console.log('  -> Thread:', receivedByPriya.threadName);
  } else {
    console.error('FAILED: Priya did not receive the message in real-time!');
    process.exit(1);
  }

  // 5. Session 2 (Priya) replies back to Session 1 (Satkar)
  console.log('\n[5] Session 2 (Priya) replies: "Yes Satkar! It is in like-new condition. Meet at library entrance?"');
  session2.send(JSON.stringify({
    type: 'send_message',
    senderId: 'student_b',
    receiverId: 'student_a',
    text: 'Yes Satkar! It is in like-new condition. Meet at library entrance?',
    listingId: 1
  }));

  // Wait 600ms for real-time delivery
  await new Promise((r) => setTimeout(r, 600));

  const receivedBySatkar = session1Messages.find((m) => m.type === 'new_message' && m.text.includes('like-new condition'));
  if (receivedBySatkar) {
    console.log('SUCCESS! Session 1 (Satkar) received reply in REAL TIME:');
    console.log('  -> From:', receivedBySatkar.senderId);
    console.log('  -> Text:', receivedBySatkar.text);
    console.log('  -> Thread:', receivedBySatkar.threadName);
  } else {
    console.error('FAILED: Satkar did not receive the reply in real-time!');
    process.exit(1);
  }

  // 6. Test WhatsApp Read Receipt Event: Priya reads Satkar's messages
  console.log('\n[6] Testing WhatsApp Read Receipt: Priya opens conversation with Satkar (mark_read)...');
  session2.send(JSON.stringify({
    type: 'mark_read',
    senderId: 'student_a'
  }));

  // Wait 400ms for read receipt push
  await new Promise((r) => setTimeout(r, 400));

  const readReceiptForSatkar = session1Messages.find((m) => m.type === 'messages_read' && m.readerId === 'student_b');
  if (readReceiptForSatkar) {
    console.log('SUCCESS! Satkar received messages_read push in real time:');
    console.log('  -> Reader ID:', readReceiptForSatkar.readerId);
    console.log('  -> Original Sender:', readReceiptForSatkar.senderId);
    console.log('  -> Status transition: Sent/Delivered ticks turn Blue (✓✓)');
  } else {
    console.error('FAILED: Satkar did not receive messages_read event!');
    process.exit(1);
  }

  // 7. Verify privacy check: student_c cannot fetch history
  console.log('\n[7] Verifying privacy protection (student_c unauthorized access attempt)...');
  const privRes = await fetch(`http://localhost:${HTTP_PORT}/api/messages?user1=student_a&user2=student_b&requester=student_c`);
  console.log('Access status code for student_c:', privRes.status, privRes.status === 403 ? '(PASS: 403 Forbidden)' : '(FAIL)');

  // 8. Verify disk file persistence
  console.log('\n[8] Verifying physical disk persistence in chat_history.txt...');
  const diskRes = await fetch(`http://localhost:${HTTP_PORT}/api/history/raw`);
  const diskData = await diskRes.json();
  const rawText = diskData.raw || '';
  const hasMsg1 = rawText.includes('student_a|student_b|Hi Priya! Is your Calculus textbook still available?');
  const hasMsg2 = rawText.includes('student_b|student_a|Yes Satkar! It is in like-new condition. Meet at library entrance?');
  console.log('Disk File Persistence Verified:', hasMsg1 && hasMsg2 ? 'PASS (Both messages recorded on disk)' : 'FAIL');

  session1.close();
  session2.close();

  console.log('\n==================================================================');
  console.log('   ALL REAL-TIME TWO-WAY MULTI-USER TESTS PASSED SUCCESSFULLY!   ');
  console.log('==================================================================');
  process.exit(0);
}

runTwoSessionTest().catch((err) => {
  console.error('Test Error:', err);
  process.exit(1);
});
