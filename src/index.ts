import { FetchMessageObject, ImapFlow } from 'imapflow';
import imap from 'imapflow';
import dotenv from 'dotenv';
import { select, Separator } from '@inquirer/prompts'
import { htmlToText } from 'html-to-text';
import path from 'path';
import { homedir } from 'os';
import { Storage, IStorage } from './Storage';
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

type Email = FetchMessageObject & {
  content: {
    htmlPart: any;
    attachments: any[];
  };
  size: number;
  mbSize: number;
};

class Client {
  private imapClient: ImapFlow;
  private UPDATE_SCREEN_INTERVAL = 200;
  private currentScreen = 'main';
  private renderedScreen = '';
  private selectedSource = '';
  private sources: Array<string> = [];
  private emails: Array<Email> = [];
  private selectedEmail: Email | null = null;
  private interval: NodeJS.Timeout | null = null;
  private mailbox: any;
  private screens: Record<string, Function> = {
    'main': this.mainScreenRender,
    'exit': this.exit,
    'sourcesList': this.sourcesListRender,
    'sourceActions': this.sourceActionsRender,
    'showEmails': this.showEmailsRender,
    'emailActions': this.emailActionsRender,
    'emailBody': this.emailBodyRender,
  };
  private storage: IStorage;

  constructor(imapClient: ImapFlow, storage: IStorage) {
    this.storage = storage;
    this.imapClient = client;
    this.sources = [
      "K.Neunkirchen@endter.eu",
      "support@hello.pokermatch.com",
      "googlecommunityteam-noreply@google.com",
      "support=redstarpoker.eu@mail-mg.redstarpoker.com",
      "noreply@steampowered.com",
      "info@emails.partypoker.com",
      "no-reply@accounts.google.com",
      "promo@emails.partypoker.com",
      "noreply@stepik.org",
      "info@codewars.com",
      "no-reply@youtube.com"
    ];

    this.run();
  }

  async run() {
    await this.imapClient.connect();
    this.mailbox = await this.imapClient.mailboxOpen('INBOX');
    this.interval = setInterval(async () => {
      if (this.renderedScreen === this.currentScreen) return;
      this.renderedScreen = this.currentScreen;

      this.screens[this.currentScreen].call(this);

    }, this.UPDATE_SCREEN_INTERVAL);
  }

  async mainScreenRender() {
    const currentScreen = await select({
      message: `Found ${this.sources.length} sources. Select further actions:`,
      choices: [
        {
          name: 'Show Sources',
          value: 'sourcesList',
        },
        {
          name: 'Reload Sources',
          value: 'reloadSources',
        },
        {
          name: 'Exit',
          value: 'exit',
        },
      ],
    });

    this.onSelect(currentScreen, () => {});
  }

  onSelect(answer: string, cb: Function) {
    if (this.screens[answer]) {
      this.currentScreen = answer;
      return;
    }

    return cb();
  }

  async sourcesListRender() {
    const answer = await select({
      message: `Select further actions:`,
      choices: [
        ...this.sources.map(source => ({
          name: source,
          value: source,
        })),
        {
          name: '← Back',
          value: 'main',
        },
      ],
      loop: false
    });

    this.onSelect(answer, () => {
      this.selectedSource = answer;
      this.currentScreen = 'sourceActions';
    });
  }

  showLoading(message: string): Function {
    const loadingChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const loadingInterval = setInterval(() => {
      process.stdout.write(`\r${loadingChars[i]} ${message}...`);
        i = (i + 1) % loadingChars.length;
    }, 100);

    function clearLoading() {
      clearInterval(loadingInterval);
      process.stdout.write('\r');
    }

    return clearLoading;
  }
  

  processEmailParts(bodyStructure: any, result: { htmlPart: any, attachments: any[] } = { htmlPart: null, attachments: [] }) {
    if (!Array.isArray(bodyStructure)) bodyStructure = [bodyStructure];
    for (let part of bodyStructure) {
      if (part.type.startsWith("text/html")) {
          result.htmlPart = part;
      } else if (part.disposition === "attachment") {
          result.attachments.push(part);
      } else if (part.childNodes) {
          this.processEmailParts(part.childNodes, result);
      }
    }
    return result;
  }

  async loadEmails() {
    const emails = client.fetch(
      { all: true, from: this.selectedSource },
      { envelope: true, bodyStructure: true }
    );
    this.emails = [];
    for await (const email of emails as AsyncIterable<Email>) {
      email.content = this.processEmailParts(email.bodyStructure);
      email.size = email.content.htmlPart.size + email.content.attachments.reduce((acc: number, attachment: any) => acc + attachment.size, 0);
      email.mbSize = email.size / 1024 / 1024;
      this.emails.push(email);
    }
  }

  async showEmailsRender() {
    const clearLoading = this.showLoading('Loading emails...');
    await this.loadEmails();
    clearLoading();

    const answer = await select({
      message: `${this.emails.length} emails loaded. Select email:`,
      choices: [
        ...this.emails.map(email => ({
          name: email.envelope.subject,
          value: email as any,
        })),
        {
          name: '← Back',
          value: 'sourcesList',
        }
      ],
    });

    this.onSelect(answer, () => {
      this.selectedEmail = answer as Email;
      this.currentScreen = 'emailActions';
    });
  }

  async emailActionsRender() {
    const answer: string = await select({
      message: `Selected email: ${this.selectedEmail?.envelope.subject}. Select further actions:`,
      choices: [
        {
          name: 'Show Email',
          value: 'emailBody',
        },
        {
          name: 'Download Email',
          value: 'downloadEmail',
        },
        ...(
          this.selectedEmail?.content.attachments.length ?
            [new Separator('Attachments:'),
            ...this.selectedEmail.content.attachments.map((attachment: any, index: number) => ({
              name: `Download attachment: ${attachment.dispositionParameters.filename || attachment.description}`,
              value: `downloadAttachment:${index}`,
            }))
          ]
          : []
        ),
        {
          name: 'Download And Delete Email',
          value: 'downloadAndDeleteEmail',
        },
        {
          name: 'Delete Email',
          value: 'deleteEmail',
        },
        {
          name: '← Back',
          value: 'showEmails',
        },
      ]
    });

    this.onSelect(answer, async () => {
      if (answer === 'deleteEmail') {
        await this.imapClient.messageDelete({ uid: (this.selectedEmail?.uid || '') as string });
        this.currentScreen = 'showEmails';
      } else if (answer.startsWith('downloadAttachment:')) {
        const index = parseInt(answer.split(':')[1]);
        const attachment = this.selectedEmail?.content.attachments[index];
        if (!attachment) return;
        const content = await this.downloadAttachment(this.selectedEmail?.seq || 0, attachment);

        this.storage.saveAttachment(
          path.join(
            this.selectedSource,
            `${this.selectedEmail?.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail?.seq.toString()}`
          ),
          attachment.dispositionParameters.filename.replace(/\s+/g, '_'),
          content
        );
        this.renderedScreen = '';
        this.currentScreen = 'emailActions';
      } else if (answer === 'downloadEmail') {
        const content = await this.downloadEmail();

        this.storage.saveEmail(
          path.join(
            this.selectedSource,
            `${this.selectedEmail?.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail?.seq.toString()}`
          ),
          content
        );
        this.renderedScreen = '';
        this.currentScreen = 'emailActions';
      } else if (answer === 'downloadAndDeleteEmail') {
        const content = await this.downloadEmail();

        this.storage.saveEmail(
          path.join(
            this.selectedSource,
            `${this.selectedEmail?.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail?.seq.toString()}`
          ),
          content
        );

        if (this.selectedEmail?.content.attachments.length) {
          for (const attachment of this.selectedEmail.content.attachments) {
            const content = await this.downloadAttachment(this.selectedEmail.seq, attachment);

            this.storage.saveAttachment(
              path.join(
                this.selectedSource,
                `${this.selectedEmail?.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail?.seq.toString()}`
              ),
              attachment.dispositionParameters.filename.replace(/\s+/g, '_'),
              content
            );
          }
        }

        await this.imapClient.messageDelete({ uid: (this.selectedEmail?.uid || '') as string });
        this.currentScreen = 'showEmails';
      }
    });
  }

  async downloadEmail(email: Email | null = this.selectedEmail): Promise<string> {
    if (!email) return '';
    const stream = await this.imapClient.download(email.seq, email.content.htmlPart.part);
    let content = '';

    for await (const chunk of stream.content) {
      content += chunk.toString();
    }

    return content;
  }

  async downloadAttachment(seq: number, attachment: any): Promise<Buffer> {
    const stream = await this.imapClient.download(seq.toString(), attachment.part);
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream.content) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async emailBodyRender() {
    const content = await this.downloadEmail();

    const answer = await select({
      message: htmlToText(content.toString(), {
        wordwrap: false,
        preserveNewlines: false,
      }),
      loop: false,
      choices: [
        {
          name: 'Download email',
          value: 'downloadEmail',
        },
        {
          name: 'Delete email',
          value: 'deleteEmail',
        },
        {
          name: '← Back',
          value: 'emailActions'
        }
      ]
    });

    this.onSelect(answer, () => {
      if (answer === 'deleteEmail') {
        this.imapClient.messageDelete({ uid: (this.selectedEmail?.uid || '') as string });
        this.currentScreen = 'showEmails';
      }
    });
  }

  async sourceActionsRender() {
    const clearLoading = this.showLoading('Loading emails...');
    await this.loadEmails();
    clearLoading();
    const answer = await select({
      message: `Selected source: ${this.selectedSource}. Select further actions:`,
      choices: [
        {
          name: `Show Emails (${this.emails.length})`,
          value: 'showEmails',
        },
        {
          name: 'Delete All Emails',
          value: 'deleteEmails',
        },
        {
          name: `Store Emails And Delete (${this.emails.reduce((acc, email) => acc + email.mbSize, 0).toFixed(2)} MB)`,
          value: 'storeAndDelete',
        },
        {
          name: '← Back',
          value: 'sourcesList',
        }
      ]
    });

    this.onSelect(answer, async () => {
      if (answer === 'deleteEmails') {
        await this.imapClient.messageDelete({ from: this.selectedSource });
        this.currentScreen = 'sourcesList';
      } else if (answer === 'storeAndDelete') {
        const clearLoading = this.showLoading('Storing emails...');
        for (const email of this.emails) {
          const content = await this.downloadEmail(email);
          await this.storage.saveEmail(
            path.join(this.selectedSource, email.envelope.subject.replace(/\s+/g, '_')),
            content
          );
          if (email.content.attachments.length) {
            for (const attachment of email.content.attachments) {
              const content = await this.downloadAttachment(email.seq, attachment);
              await this.storage.saveAttachment(
                path.join(this.selectedSource, email.envelope.subject.replace(/\s+/g, '_')),
                attachment.dispositionParameters.filename.replace(/\s+/g, '_'), 
                content
              );
            }
          }
        }
        clearLoading();
        await this.imapClient.messageDelete({ from: this.selectedSource });
        this.currentScreen = 'sourcesList';
      }
    });
  }

  exit() {
    clearInterval(this.interval!);
    process.exit(0);
  }
}

const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}. Disconnecting...`);
    await client.logout();
    console.log('Disconnected');
    process.exit(0);
  });
});

new Client(
  client,
  new Storage(path.join(homedir(), 'email_backup'))
);
