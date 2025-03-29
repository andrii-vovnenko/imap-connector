import { ImapFlow } from 'imapflow';
import imap from 'imapflow';

import dotenv from 'dotenv';
dotenv.config();

const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: {
    user: process.env.EMAIL || '',
    pass: process.env.PASS,
  },
  logger: false,

});

const fetchMessageParams: imap.FetchQueryObject = {
  uid: true,
  flags: true,
  envelope: true,
  size: true,
  source: true,
  bodyStructure: true
};

async function main() {
  try {
    await client.connect();
    let mailbox = await client.mailboxOpen('INBOX');
    let counter = 0;
    const sourceToCount: Record<string, number> = {};
    for await (let msg of client.fetch('1:500', fetchMessageParams)){
      const source = msg.envelope.sender.map(s => s.address).join(', ');
      sourceToCount[source] = (sourceToCount[source] || 0) + 1;
      counter++;
   }
    console.log('Source to count:', sourceToCount);
    console.log('Total messages:', counter);
    console.log('Mailbox:', mailbox.exists);
  } catch (e) {
    console.error('Error connecting to IMAP server:', e);
  } finally {
    await client.logout();
    console.log('Disconnected');
  }

};

const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}. Disconnecting...`);
    await client.logout();
    console.log('Disconnected');
    process.exit(0);
  });
});

main();