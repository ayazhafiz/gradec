#!/usr/bin/env node

import * as readline from 'readline';
import * as yargs from 'yargs';
import * as api from './api';
import chalk from 'chalk';
import * as open from 'open';
import {GradecServer} from './server';

interface GradecArgs {
  files: {
    commits: string,
    tests: string,
  };
  bounds: {
    start: number,
    end: number,
  };
  openIn: string|undefined,
}

function getArgv(): GradecArgs {
  const argv =
      yargs.usage('Usage: $0 [options]')
          .example(
              '$0 -c commits.txt -t travis.txt -r 1 20',
              'grade lines 1-20 in `commits.txt\' and `travis.txt\'')
          .example(
              '$0 -c c.txt -t t.txt -r 5 10 -ao "Google Chrome"',
              'grade lines 5-10 in `c.txt\' and `t.txt\', auto-opening links in Google Chrome')
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
          .help('h')
          .alias('h', 'help')
          .wrap(yargs.terminalWidth())
          .argv;

  const {ao, c: commits, t: tests, r: range} = argv;
  const [start, end] = range.map(Number);
  const gradecArgs: GradecArgs = {
    bounds: {start: start - 1, end: end - 1},
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
      wait: false,
      app,
    });
  }
}

async function main(): Promise<number> {
  const TOKEN_ENV = 'GRADEC_ACCESS_TOKEN';
  const accessToken = process.env[TOKEN_ENV];
  if (!accessToken) {
    console.error(`Expected the \`${
        TOKEN_ENV}' environment variable to be present, but it wasn't found.`);
    console.error(`See the \`gradec' README for more details.`);
    return 1;
  }
  const argv = getArgv();
  const {openIn} = argv;

  const server = new GradecServer(argv.files, argv.bounds);

  console.log(Message.Welcome);
  console.log(Message.CreateGrader);

  const grader = await server.makeGrader(accessToken);

  for await (const handle of grader) {
    const {position, commitUrl, calculateAndPostGrade} = handle;

    // Ask user if they'd like to grade the next assignment.
    if (await negativeResponse(Message.NextAssignment)) {
      break;
    }

    // Provide user with next assignment. Open a browser window to the
    // assignment if the user has asked for auto-opened links.
    console.log(Message.AssignmentPosition(position.at, position.total));
    console.log(Message.LinkToAssignment(commitUrl));
    await maybeAutoOpen(commitUrl, openIn);

    // Wait until user is done grading the commit. If they bail before finishing
    // grading, `gradec` is done.
    if (await negativeResponse(Message.TypeWhenDone)) {
      break;
    }

    // Provide user with calculated assignment grade. Open a browser window to
    // the score comment if the user has asked for auto-opened links.
    const gradeResult = await calculateAndPostGrade();
    console.log(Message.CalculatedGrade(gradeResult));
    await maybeAutoOpen(gradeResult.url, openIn);
  }
  console.log(Message.Exit);

  return 0;
}

if (require.main === module) {
  main().then((ec) => process.exitCode = ec);
}
