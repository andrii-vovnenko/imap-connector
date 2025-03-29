import { ImapFlow } from 'imapflow';

import dotenv from 'dotenv';
dotenv.config();

console.log({
  EMAIL: process.env.EMAIL,
  PASS: process.env.PASS,
});

const ImapClient = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: {
    user: process.env.EMAIL || '',
    pass: process.env.PASS,
  },
  logger: false,
});

async function main() {
  await ImapClient.connect();
  let mailbox = await ImapClient.mailboxOpen('INBOX');
};

main();