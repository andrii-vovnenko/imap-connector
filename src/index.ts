import { select, Separator } from '@inquirer/prompts'
import { htmlToText } from 'html-to-text';
import path from 'path';
import { homedir } from 'os';
import { Storage, IStorage } from './Storage';
import { client, Email, IImapClient } from './ImapClient';

class Client {
  private imapClient: IImapClient;
  private UPDATE_SCREEN_INTERVAL = 200;
  private currentScreen = 'main';
  private renderedScreen = '';
  private selectedSource = '';
  private emails: Array<Email> = [];
  private selectedEmail: Email | null = null;
  private interval: NodeJS.Timeout | null = null;
  private mailbox: any = null;
  private screens: Record<string, Function> = {
    'main': this.mainScreenRender,
    'selectSource': this.selectSourceRender,
    'exit': this.exit,
    'sourcesList': this.sourcesListRender,
    'sourceActions': this.sourceActionsRender,
    'showEmails': this.showEmailsRender,
    'emailActions': this.emailActionsRender,
    'emailBody': this.emailBodyRender,
  };
  private sourceToEmailsCount: Record<string, number> = {};
  private storage: IStorage;

  constructor(imapClient: IImapClient, storage: IStorage) {
    this.storage = storage;
    this.imapClient = imapClient;

    this.run();
  }


  async loadSources() {
    const sources = this.imapClient.fetch({ all: true }, { envelope: true });
    const clearLoading = this.showLoading('Loading sources...');

    this.sourceToEmailsCount = {};
    for await (const source of sources) {
      const sourceAddress = source.envelope.from[0].address || 'unknown';
      this.sourceToEmailsCount[sourceAddress] = (this.sourceToEmailsCount[sourceAddress] || 0) + 1;
    }

    clearLoading();
  }

  async run() {
    await this.imapClient.connect();
    this.interval = setInterval(async () => {
      if (this.renderedScreen === this.currentScreen) return;
      this.renderedScreen = this.currentScreen;

      this.screens[this.currentScreen].call(this);

    }, this.UPDATE_SCREEN_INTERVAL);
  }

  async mainScreenRender() {

    if (this.mailbox) {
      await this.imapClient.mailboxClose();
    }

    const mailboxes = await this.imapClient.list();

    const answer = await select({
      message: `Select mailbox:`,
      choices: [
        ...mailboxes.map(mailbox => ({
          name: mailbox.name,
          value: mailbox.path,
        })),
        {
          name: 'Exit',
          value: 'exit',
        },
      ],
    });

    this.onSelect(answer, async () => {
      this.mailbox = await this.imapClient.mailboxOpen(answer);
      this.currentScreen = 'selectSource';
    });
  }

  async selectSourceRender() {
    const clearLoading = this.showLoading('Loading sources...');
    await this.loadSources();
    clearLoading();

    const answer = await select({
      message: `Found ${Object.keys(this.sourceToEmailsCount).length} sources. Select further actions:`,
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

    this.onSelect(answer, async () => {
      if (answer === 'reloadSources') {
        await this.loadSources();
        this.currentScreen = 'sourcesList';
      }
    });
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
      message: `Select source:`,
      choices: [
        ...Object.keys(this.sourceToEmailsCount)
          .sort((a, b) => this.sourceToEmailsCount[b] - this.sourceToEmailsCount[a])
          .map(source => ({
              name: `${source} (${this.sourceToEmailsCount[source]})`,
              value: source,
            })),
        {
          name: '← Back',
          value: 'main',
        },
      ]
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
  

  processEmailParts(bodyStructure: any, result: { htmlPart: any, attachments: any[], textPart: any } = { htmlPart: null, attachments: [], textPart: null }) {
    if (!Array.isArray(bodyStructure)) bodyStructure = [bodyStructure];
    for (let part of bodyStructure) {
      if (part.type === "text/plain") {
        result.textPart = part;
      } else if (part.type === "text/html") {
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
      email.size = (email.content.htmlPart?.size || email.content.textPart?.size) + email.content.attachments.reduce((acc: number, attachment: any) => acc + attachment.size, 0);
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
          name: `${email.envelope.subject} ${email.content.htmlPart ? 'html' : 'text'}`,
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
          this.selectedEmail?.content.htmlPart ? 'email.html' : 'email.txt',
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
          this.selectedEmail?.content.htmlPart ? 'email.html' : 'email.txt',
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
    const stream = await this.imapClient.download(email.seq.toString(), email.content.htmlPart?.part || email.content.textPart?.part);
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
        delete this.sourceToEmailsCount[this.selectedSource];
        this.currentScreen = 'sourcesList';
      } else if (answer === 'storeAndDelete') {
        const clearLoading = this.showLoading('Storing emails...');
        for (const email of this.emails) {
          const content = await this.downloadEmail(email);
          await this.storage.saveEmail(
            path.join(this.selectedSource, email.envelope.subject.replace(/\s+/g, '_')),
            email.content.htmlPart ? 'email.html' : 'email.txt',
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
        delete this.sourceToEmailsCount[this.selectedSource];
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
