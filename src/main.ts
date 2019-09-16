#!/usr/bin/env node

import chalk from 'chalk';
import * as open from 'open';
import * as readline from 'readline';
import * as yargs from 'yargs';
import * as api from './api';
import {GradecServer} from './server';

enum GradecCommand {
  grade = 'grade',
  list = 'list',
}

interface GradecArgs {
  accessToken: string;
  command: GradecCommand;
  files: {
    commits: string,
    tests: string,
  };
  bounds: {
    start: number,
    end: number,
  };
  openIn: string|undefined;
}

function getArgv() {
  const TOKEN_ENV = 'GRADEC_ACCESS_TOKEN';
  const accessToken = process.env[TOKEN_ENV];
  if (!accessToken) {
    console.error(`Expected the \`${
        TOKEN_ENV}' environment variable to be present, but it wasn't found.`);
    console.error(`See the \`gradec' README for more details.`);
    return process.exit(1);
  }

  const argv =
      yargs.usage('Usage: $0 <command> <options>')
          .command('grade', 'perform assignment grading')
          .command('list', 'list assignment grade status')
          .options({
            ao: {
              alias: 'auto-open',
              default: 'Safari',
              describe: 'Automatically opens links in a browser',
              type: 'string',
            },
            c: {
              alias: 'commits',
              demandOption: true,
              describe: '(GitHub) commits to grade',
              requiresArg: true,
              type: 'string',
            },
            r: {
              alias: 'range',
              demandOption: true,
              describe: 'Space-separated range of line numbers to grade',
              nargs: 2,
              type: 'array',
            },
            t: {
              alias: 'tests',
              demandOption: true,
              describe: 'CI tests to grade',
              requiresArg: true,
              type: 'string',
            },
          })
          .example(
              '$0 grade -c commits.txt -t travis.txt -r 1 20',
              'grade lines 1-20 in `commits.txt\' and `travis.txt\'')
          .example(
              '$0 -c c.txt -t t.txt -r 5 10 -ao "Google Chrome"',
              'grade lines 5-10 in `c.txt\' and `t.txt\', auto-opening links in Google Chrome')
          .example(
              '$0 list -c c.txt -t t.xt -r 5 10',
              'list grading status of lines 5-10 in `c.txt\' and `t.txt\'')
          .example(
              '$0 list -c c.txt -t t.xt -r 5 10 > grades.txt',
              'write any known grades for assignments on lines 5-10 to `grades.txt\'')
          .help('h')
          .alias('h', 'help')
          .wrap(yargs.terminalWidth())
          .argv;

  const {ao, c: commits, t: tests, r: range, _: commands} = argv;

  let command: GradecCommand =
      GradecCommand[commands[0] as keyof typeof GradecCommand];
  if (commands.length === 0 || !command) {
    command = GradecCommand.grade;
  }

  const [start, end] = range.map(Number);
  const gradecArgs: GradecArgs = {
    accessToken,
    bounds: {start: start - 1, end: end - 1},
    command,
    files: {commits, tests},
    openIn: ao,
  };

  return gradecArgs;
}

const t = (str: string) => `\t${str}`;
const Message = {
  AssignmentPosition: (current: number, total: number) => chalk.yellow(
      `Now grading assignment ${chalk.blue(`${current} of ${total}`)}\n`),
  CalculatedGrade: ({comment, url}: api.CommentScoreResult) => '\n' +
      t(`${chalk.inverse(comment)}\n\n`) +
      t(`${chalk.bold('Please verify')} this comment at ${
          chalk.green(url)}.\n`),
  CreateGrader:
      chalk.dim(`gradec is initializing. This may take a few seconds...\n`),
  Exit: chalk.yellow(`Done. Exiting.`),
  LinkToAssignment: (link: string) =>
      `The link to the assignment is\n\n` + chalk.green(t(`${link}\n`)),
  NextAssignment: {
    affirm: 'Y',
    naffirm: 'N',
    query: chalk.yellow('Would you like to grade the next assignment? (Y/N) '),
  },
  TypeWhenDone: {
    affirm: 'D',
    naffirm: 'N',
    query: chalk.yellow(
        'Please type (D) when you are done grading at the above link. Type (N) to abort. '),
  },
  Welcome: chalk.yellow(`Welcome to gradec!`),
};

async function ask(
    query: string,
    ): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function negativeResponse(
    to: {query: string, affirm: string, naffirm: string}): Promise<boolean> {
  let resp: string|undefined;
  while (!resp || ![to.affirm, to.naffirm].includes(resp)) {
    resp = (await ask(to.query)).toUpperCase();
  }
  return resp === to.naffirm;
}

async function maybeAutoOpen(link: string, app: string|undefined) {
  if (app) {
    open(link, {
      app,
      wait: false,
    });
  }
}

async function grade(argv: GradecArgs): Promise<number> {
  const {openIn} = argv;

  console.error(Message.Welcome);
  console.error(Message.CreateGrader);

  const server = new GradecServer(argv.files, argv.bounds);
  const grader = await server.makeGrader(argv.accessToken);

  for await (const handle of grader) {
    const {position, commitUrl, calculateAndPostGrade} = handle;

    // Ask user if they'd like to grade the next assignment.
    if (await negativeResponse(Message.NextAssignment)) {
      break;
    }

    // Provide user with next assignment. Open a browser window to the
    // assignment if the user has asked for auto-opened links.
    console.error(Message.AssignmentPosition(position.at, position.total));
    console.error(Message.LinkToAssignment(commitUrl));
    await maybeAutoOpen(commitUrl, openIn);

    // Wait until user is done grading the commit. If they bail before finishing
    // grading, `gradec` is done.
    if (await negativeResponse(Message.TypeWhenDone)) {
      break;
    }

    // Provide user with calculated assignment grade. Open a browser window to
    // the score comment if the user has asked for auto-opened links.
    const gradeResult = await calculateAndPostGrade();
    console.error(Message.CalculatedGrade(gradeResult));
    await maybeAutoOpen(gradeResult.url, openIn);
  }
  console.error(Message.Exit);

  return 0;
}

async function list(argv: GradecArgs): Promise<number> {
  const server = new GradecServer(argv.files, argv.bounds);
  const status = await server.getGradeStatus(argv.accessToken);
  const size = status.length;

  const ungraded = status.filter(comment => !comment.score);
  const graded = status.filter(comment => !!comment.score);

  console.error(
      `${chalk.red(`${ungraded.length}/${size}`)}\tassignments still ungraded`);
  console.error(
      `${chalk.green(`${graded.length}/${size}`)}\tassignments graded`);
  console.error(
      chalk.inverse(`Printing graded assignments and scores to STDOUT:\n`));

  for (const {author, score} of graded) {
    console.log(`${author}\t${score}`);
  }

  return 0;
}

async function main(): Promise<number> {
  const argv = await getArgv();
  switch (argv.command) {
    case GradecCommand.grade:
      return grade(argv);
    case GradecCommand.list:
      return list(argv);
  }
}

if (require.main === module) {
  main().then((ec) => process.exitCode = ec);
}
