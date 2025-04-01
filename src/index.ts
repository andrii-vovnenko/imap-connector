import { ImapFlow } from 'imapflow';
import imap from 'imapflow';
import dotenv from 'dotenv';
import fs from 'fs';
import { select } from '@inquirer/prompts'

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
  }; 

  constructor(imapClient: ImapFlow) {
    this.imapClient = client;
    this.sources = [
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
      { envelope: true }
    );

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
          value: email.uid,
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

const fetchMessageParams: imap.FetchQueryObject = {
  envelope: true,
};

async function main() {
  try {
    await client.connect();
    let mailbox = await client.mailboxOpen('INBOX');
    const emails = client.fetch(
      { all: true, from: 'support@hello.pokermatch.com' },
      { envelope: true }
    );

    for await (const email of emails) {
      console.log(email);
    }

  } catch (e) {
    console.error('Error connecting to IMAP server:', e);
  } finally {
    await client.logout();
    console.log('Disconnected');
  }

};
// main();
const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}. Disconnecting...`);
    await client.logout();
    console.log('Disconnected');
    process.exit(0);
  });
});

new Client(client);
