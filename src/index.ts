import { ImapFlow } from 'imapflow';
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

class Client {
  private imapClient: ImapFlow;
  private UPDATE_SCREEN_INTERVAL = 200;
  private currentScreen = 'main';
  private renderedScreen = '';
  private selectedSource = '';
  private sources: Array<string> = [];
  private emails: Array<any> = [];
  private selectedEmail: any;
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
          name: 'show sources',
          value: 'sourcesList',
        },
        {
          name: 'reload sources',
          value: 'reloadSources',
        },
        {
          name: 'exit',
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
          name: 'back',
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

  async showEmailsRender() {
    const loadingChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const loadingInterval = setInterval(() => {
      process.stdout.write(`\r${loadingChars[i]} Loading emails...`);
      i = (i + 1) % loadingChars.length;
    }, 100);
    const emails = client.fetch(
      { all: true, from: this.selectedSource },
      { envelope: true, bodyStructure: true }
    );
    this.emails = [];
    for await (const email of emails) {
      this.emails.push(email);
    }
    clearInterval(loadingInterval);
    process.stdout.write('\r');
    const answer = await select({
      message: `${this.emails.length} emails loaded. Select email:`,
      choices: [
        ...this.emails.map(email => ({
          name: email.envelope.subject,
          value: email,
        })),
        {
          name: 'back',
          value: 'sourcesList',
        }
      ],
    });

    this.onSelect(answer, () => {
      this.selectedEmail = answer;
      this.currentScreen = 'emailActions';
    });
  }

  async emailActionsRender() {
    const email: {
      htmlPart: any,
      attachments: any[],
    } = {
      htmlPart: null,
      attachments: [],
    };

    function processEmailParts(parts: any) {
      if (!Array.isArray(parts)) parts = [parts];
      for (let part of parts) {
        if (part.type.startsWith("text/html")) {
            email.htmlPart = part;
        } else if (part.disposition === "attachment") {
            email.attachments.push(part);
        } else if (part.childNodes) {
            processEmailParts(part.childNodes);
        }
      }
    }

    processEmailParts(this.selectedEmail.bodyStructure);

    this.selectedEmail.content = email;

    const answer = await select({
      message: `Selected email: ${this.selectedEmail.envelope.subject}. Select further actions:`,
      choices: [
        {
          name: 'show email',
          value: 'emailBody',
        },
        {
          name: 'download email',
          value: 'downloadEmail',
        },
        ...(
          email.attachments.length ?
            [new Separator('Attachments:'),
            ...email.attachments.map((attachment: any, index: number) => ({
              name: `Download attachment: ${attachment.dispositionParameters.filename || attachment.description}`,
              value: `downloadAttachment:${index}`,
            }))
          ]
          : []
        ),
        {
          name: 'download and delete email',
          value: 'downloadAndDeleteEmail',
        },
        {
          name: 'delete email',
          value: 'deleteEmail',
        },
        {
          name: 'back',
          value: 'showEmails',
        },
      ]
    });

    this.onSelect(answer, async () => {
      if (answer === 'deleteEmail') {
        await this.imapClient.messageDelete({ uid: this.selectedEmail });
        this.currentScreen = 'showEmails';
      } else if (answer.startsWith('downloadAttachment:')) {
        const index = parseInt(answer.split(':')[1]);
        const attachment = this.selectedEmail.content.attachments[index];
        const stream = await this.imapClient.download(this.selectedEmail.seq, attachment.part);
        
        const chunks: Buffer[] = [];
        for await (const chunk of stream.content) {
          chunks.push(Buffer.from(chunk));
        }
        const content = Buffer.concat(chunks);

        this.storage.saveAttachment(
          path.join(
            this.selectedSource,
            `${this.selectedEmail.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail.seq.toString()}`
          ),
          attachment.dispositionParameters.filename.replace(/\s+/g, '_'),
          content
        );
        this.renderedScreen = '';
        this.currentScreen = 'emailActions';
      } else if (answer === 'downloadEmail') {
        const email = await this.imapClient.download(
          this.selectedEmail.seq,
          this.selectedEmail.content.htmlPart.part
        );
        let content = '';
        for await (const chunk of email.content) {
          if (email.meta.charset) {
            content += chunk.toString(email.meta.charset);
          } else {
            content += Buffer.from(chunk);
          }
        }

        this.storage.saveEmail(
          path.join(
            this.selectedSource,
            `${this.selectedEmail.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail.seq.toString()}`
          ),
          content
        );
        this.renderedScreen = '';
        this.currentScreen = 'emailActions';
      } else if (answer === 'downloadAndDeleteEmail') {
        const email = await this.imapClient.download(
          this.selectedEmail.seq,
          this.selectedEmail.content.htmlPart.part
        );
        let content = '';
        for await (const chunk of email.content) {
          content += chunk.toString();
        }

        this.storage.saveEmail(
          path.join(
            this.selectedSource,
            `${this.selectedEmail.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail.seq.toString()}`
          ),
          content
        );

        if (this.selectedEmail.content.attachments.length) {
          for (const attachment of this.selectedEmail.content.attachments) {
            const stream = await this.imapClient.download(this.selectedEmail.seq, attachment.part);
            const chunks: Buffer[] = [];
            for await (const chunk of stream.content) {
              chunks.push(Buffer.from(chunk));
            }
            const content = Buffer.concat(chunks);

            this.storage.saveAttachment(
              path.join(
                this.selectedSource,
                `${this.selectedEmail.envelope.subject.replace(/\s+/g, '_')}_${this.selectedEmail.seq.toString()}`
              ),
              attachment.dispositionParameters.filename.replace(/\s+/g, '_'),
              content
            );
          }
        }

        await this.imapClient.messageDelete({ uid: this.selectedEmail.uid });
        this.currentScreen = 'showEmails';
      }
    });
  }

  async emailBodyRender() {
    const email = await this.imapClient.download(
      this.selectedEmail.seq,
      this.selectedEmail.content.htmlPart.part
    );

    const chunks: Buffer[] = [];
      for await (const chunk of email.content) {
        chunks.push(Buffer.from(chunk));
      }
    const content = Buffer.concat(chunks);


    const answer = await select({
      message: htmlToText(content.toString(), {
        wordwrap: false,
        ignoreHref: true,
        ignoreImage: true,
        ignoreLink: true,
        ignoreHeading: true,
        preserveNewlines: false,
        singleNewLineParagraphs: true,
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
          name: 'back',
          value: 'emailActions'
        }
      ]
    });

    this.onSelect(answer, () => {
      if (answer === 'deleteEmail') {
        this.imapClient.messageDelete({ uid: this.selectedEmail });
        this.currentScreen = 'showEmails';
      }
    });
  }

  async sourceActionsRender() {
    const answer = await select({
      message: `Selected source: ${this.selectedSource}. Select further actions:`,
      choices: [
        {
          name: 'show emails',
          value: 'showEmails',
        },
        {
          name: 'delete emails',
          value: 'deleteEmails',
        },
        {
          name: 'back',
          value: 'sourcesList',
        }
      ]
    });

    this.onSelect(answer, () => {});
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
