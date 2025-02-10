import repl from 'repl';

const myAPI = {
  time: () => `Current time: ${new Date().toLocaleTimeString()}`,
};

const replServer = repl.start({
  prompt: "> ",
  eval: (cmd, _context, _filename, callback) => {
    console.log(`Received command: ${cmd}`);
    try {
      const result = eval(cmd); // Execute command
      callback(null, result);
    } catch (err) {
      callback(err as Error, null);
    }
  },
  writer: (output) => `${output}`, // Format output
});
