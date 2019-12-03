import 'jasmine';

import * as fs from 'fs';
import * as path from 'path';
import * as rp from 'request-promise';

import {Grader, SCORE_PREFIX, TESTS_PREFIX} from '../src/grader';
import {GradecServer} from '../src/server';

const COMMITS_FILE = path.resolve('test/commits.txt');
const TESTS_FILE = path.resolve('test/tests.txt');
const ACCESS_TOKEN = process.env.GRADEC_ACCESS_TOKEN!;
const REPO = 'ayazhafiz/gradec';

async function clean() {
  const commits = await fs.readFileSync(COMMITS_FILE, 'utf8')
                      .toString()
                      .split(/\n/)
                      .filter((line) => line.length)
                      .map((line) => line.split(' ')[1])
                      .filter((url) => url.startsWith('http'))
                      .map((url) => url.split('/').reverse()[0]);
  for (const commit of commits) {
    const commitCommentsUrl =
        `https://api.github.com/repos/${REPO}/commits/${commit}/comments`;

    const request = {
      headers: {
        'Authorization': `token ${ACCESS_TOKEN}`,
        'User-Agent': 'gradec',
      },
      json: true,
    };

    const allComments = await rp.get({...request, uri: commitCommentsUrl});
    const applicable = allComments.filter(
        (comment: {body: string}) => comment.body.startsWith(SCORE_PREFIX) ||
            comment.body.startsWith(TESTS_PREFIX));

    for (const comment of applicable) {
      // tslint:disable-next-line:no-empty
      await rp.delete({...request, uri: comment.url}).catch(() => {});
    }
  }
}

describe('gradec', async () => {
  let grader: Grader;
  let errors: ReadonlyArray<string>;

  async function createGrader(start: number, end: number) {
    const server = new GradecServer(
        {commits: COMMITS_FILE, tests: TESTS_FILE}, {start, end});
    grader = await server.makeGrader(ACCESS_TOKEN);
    errors = server.getErrors();
  }

  afterEach(async (done) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));  // Rate limiting
    await clean();
    done();
  });

  describe('grader size', async () => {
    async function expectGraderOfSize(size: number) {
      let counter = 0;
      for await (const next of grader) {
        expect(next.position.at).toBe(counter + 1);
        expect(next.position.total).toBe(size);
        ++counter;
      }
      expect(counter).toBe(size);
    }

    it('should create grader of size zero if start is after end', async () => {
      await createGrader(1, -1);
      await expectGraderOfSize(0);
    });

    it('should create grader of size one if start equals end', async () => {
      await createGrader(0, 0);
      await expectGraderOfSize(1);
    });

    it('should create grader of expected size', async () => {
      await createGrader(0, 1);
      await expectGraderOfSize(2);
    });

    it('should create grader that stops at bounds of commits file',
       async () => {
         await createGrader(0, 10);
         await expectGraderOfSize(2);
       });

    it('should have size not including grading the same file', async () => {
      await createGrader(0, 1);
      let counter = 0;
      for await (const handle of grader) {
        await handle.calculateAndPostGrade();
        ++counter;
      }
      expect(counter).toBe(2);

      await createGrader(0, 1);
      await expectGraderOfSize(0);
    });
  });

  describe('errors', async () => {
    it('should correctly detect errors', async () => {
      await createGrader(0, 2);
      expect(errors.length).toBe(1);
      expect(errors[0]).toBe('GitHub commit missing for nothafiz');
    });

    it('should not detect errors where there are none', async () => {
      await createGrader(0, 1);
      expect(errors.length).toBe(0);
    });
  });

  it('should grade correctly', async () => {
    await createGrader(0, 1);
    const scores: number[] = [];
    const comments: string[] = [];
    for await (const handle of grader) {
      const res = await handle.calculateAndPostGrade();
      comments.push(res.url);
      scores.push(res.score);
    }

    expect(scores.length).toBe(2);
    expect(scores).toEqual(jasmine.arrayContaining([90, 178]));
  });

  it('should not post link to tests multiple times', async () => {
    await createGrader(0, 0);
    let firstUrl: string;
    for await (const handle of grader) {
      firstUrl = handle.testsCommentUrl;
    }

    await createGrader(0, 0);
    let nextUrl: string;
    for await (const handle of grader) {
      nextUrl = handle.testsCommentUrl;
    }

    expect(nextUrl!).toBe(firstUrl!);
  });
});
