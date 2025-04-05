import { FetchMessageObject, ImapFlow } from 'imapflow';
import dotenv from 'dotenv';

dotenv.config();

export type IImapClient = ImapFlow;

export const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: {
    user: process.env.EMAIL || '',
    pass: process.env.PASS,
  },
  logger: false,
});

export type Email = FetchMessageObject & {
  content: {
    htmlPart: any;
    textPart: any;
    attachments: any[];
  };
  size: number;
  mbSize: number;
};

export type Mailbox = {
  path: string;
  name: string;
}