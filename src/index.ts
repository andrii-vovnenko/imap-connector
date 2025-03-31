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
  private interval: NodeJS.Timeout | null = null;
  private screens: Record<string, Function> = {
    'main': this.mainScreenRender,
    'exit': this.exit,
    'sourcesList': this.sourcesListRender,
    'sourceActions': this.sourceActionsRender,
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

// async function main() {
//   try {
//     await client.connect();
//     let mailbox = await client.mailboxOpen('INBOX');
    
//     await fillSources();
//   } catch (e) {
//     console.error('Error connecting to IMAP server:', e);
//   } finally {
//     await client.logout();
//     console.log('Disconnected');
//   }

// };

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