#!/usr/bin/env node

import chalk from 'chalk';
import * as readline from 'readline';
import * as yargs from 'yargs';
import * as api from './api';
import {Grader} from './grader';

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
  emojify: boolean;
}

function getArgs() {
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
              describe: 'Space-separated range of assignments to grade',
              nargs: 2,
              type: 'array',
            },
            t: {
              alias: 'tests',
              demandOption: true,
              describe: 'Links to CI builds corresponding to commits',
              requiresArg: true,
              type: 'string',
            },
            emojify: {
              demandOption: false,
              describe: 'Use emojis when grading. 100 -> 💯',
              type: 'boolean',
              default: false,
            }
          })
          .example(
              '$0 grade -c commits.txt -t travis.txt -r 1 20',
              'grade lines 1-20 in `commits.txt\' and `travis.txt\'')
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

  const {c: commits, t: tests, r: range, emojify, _: commands} = argv;

  const command = commands.length === 0 ?
      GradecCommand.grade :
      GradecCommand[commands[0] as keyof typeof GradecCommand];

  const [start, end] = range.map(Number);
  const gradecArgs: GradecArgs = {
    accessToken,
    bounds: {start: start - 1, end: end - 1},
    command,
    files: {commits, tests},
    emojify,
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
  Error: (errors: ReadonlyArray<string>): string =>
      chalk.red(`Encountered the following errors:\n`) +
      errors.map((error) => t(chalk.bold(error))).join('\n') + '\n',
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

async function grade(argv: GradecArgs): Promise<number> {
  console.error(Message.Welcome);
  console.error(Message.CreateGrader);

  const {grader, errors} = await Grader.makeGrader(
      argv.files.commits,
      argv.files.tests,
      argv.bounds,
      argv.accessToken,
      argv.emojify,
  );

  if (errors.length > 0) {
    console.error(Message.Error(errors));
  }

  for await (const handle of grader) {
    const {position, commitUrl, calculateAndPostGrade} = handle;

    if (await negativeResponse(Message.NextAssignment)) {
      break;
    }

    console.error(Message.AssignmentPosition(position.at, position.total));
    console.error(Message.LinkToAssignment(commitUrl));

    if (await negativeResponse(Message.TypeWhenDone)) {
      break;
    }

    const gradeResult = await calculateAndPostGrade();
    console.error(Message.CalculatedGrade(gradeResult));
  }
  console.error(Message.Exit);

  return 0;
}

async function list(argv: GradecArgs): Promise<number> {
  const {grader, errors} = await Grader.makeGrader(
      argv.files.commits,
      argv.files.tests,
      argv.bounds,
      argv.accessToken,
      argv.emojify,
  );

  if (errors.length > 0) {
    console.error(Message.Error(errors));
  }

  const scores = await grader.getAssignmentScores();
  const size = status.length;

  const ungraded = scores.filter((comment) => !comment.score);
  const graded = scores.filter((comment) => !!comment.score);

  console.error(
      `${chalk.red(`${ungraded.length}/${size}`)}\tassignments still ungraded`);
  console.error(
      `${chalk.green(`${graded.length}/${size}`)}\tassignments graded`);
  console.error(
      chalk.inverse(`Printing graded assignments and scores to STDOUT:\n`));

  for (const {author, score} of graded) {
    console.log(`${author.padEnd(15)}\t${score}`);
  }

  return 0;
}

function main(): Promise<number> {
  const argv = getArgs();
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
