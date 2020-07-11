import * as fs from 'fs';
import * as rp from 'request-promise';
import * as util from 'util';
import * as api from './api';

const MAXSCORE: number = Number(process.env.MAXSCORE || 100);
const RE_GH_COMMIT = /.*github.com\/(.*)\/commit\/(.*)/;
const RE_SCORE_COMMENT = /^([+|-]\d+)(:.*)?/;
const SCORE_PREFIX = 'Score:';
const TESTS_PREFIX = 'CI tests at';

/** Describes a "<author> <url>" line listing. */
interface Submission {
  readonly author: string;
  readonly url: string;
}

function getSubmissions(commitsFile: string, testsFile: string):
    {commits: Submission[], tests: Submission[]} {
  function split(file: string) {
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.length)  // discard empty lines
        .map((line) => {
          // A line in the file should look like
          //   "<author> <url>"
          const [author, url] = line.split(' ');
          return {author, url};
        });
  }

  return {commits: split(commitsFile), tests: split(testsFile)};
}

function handleFailedRequest(err: api.CommitCommentsError): number {
  console.error(`Failed to process request\n${util.inspect(err.options)}`);
  console.error(`Dumping request error message and exiting.\n`);
  console.error(util.inspect(err.message));
  return 1;
}

/**
 * Creates a GitHub commit comments request object from some request metadata.
 * See `getCommitRequestMetadata` for more details on the metadata.
 */
function makeRequest(
    accessToken: string, {
      repo,
      commit,
    }: api.CommitMetadata,
    message?: string): api.CommitCommentsRequest {
  const request: any = {
    headers: {
      'Authorization': `token ${accessToken}`,
      'User-Agent': 'gradec',
    },
    json: true,
    uri: `https://api.github.com/repos/${repo}/commits/${commit}/comments`,
  };
  if (message) {
    request.body = {};
    request.body.body = message;
  }
  return request;
}

/**
 * Gets all the comments on a particular commit.
 */
async function getComments(token: string, commit: api.CommitMetadata):
    Promise<api.CommitCommentsResponse[]> {
  return rp.get(makeRequest(token, commit)).catch(handleFailedRequest);
}

/**
 * Posts a comment on a particular commit, but not on any particular line or
 * file in the commit.
 */
async function postComment(
    token: string,
    commit: api.CommitMetadata,
    comment: string,
    ): Promise<api.CommitCommentsResponse> {
  return rp.post(makeRequest(token, commit, comment))
      .promise()
      .catch(handleFailedRequest);
}

/**
 * Returns the grade of an assignment if it already has one as a comment,
 * otherwise returns `undefined`.
 */
async function getExistingGrade(
    token: string, commit: api.CommitMetadata): Promise<number|undefined> {
  const comments = await getComments(token, commit);
  for (const comment of comments) {
    if (!comment.path && comment.body.startsWith(SCORE_PREFIX)) {
      return Number(comment.body.split(SCORE_PREFIX)[1].split('/')[0].trim());
    }
  }
  return undefined;
}

/**
 * Reads comments of form
 *   ([+|-]\d+)(:.*)?
 *   ^^^^^^^^^^------- $SCORE
 *             ^^^^^-- $COMMENT
 * on the commit and accumulates discovered $SCORES on MAX_SCORE.
 */
async function gradeAssignment(
    token: string,
    commit: api.CommitMetadata,
    ): Promise<number> {
  const comments: api.CommitCommentsResponse[] =
      await rp.get(makeRequest(token, commit)).catch(handleFailedRequest);

  const totalScore = comments.reduce((res, comment) => {
    const match = comment.body.match(RE_SCORE_COMMENT);
    if (match) {
      res += Number(match[1]);
    }
    return res;
  }, MAXSCORE);

  return totalScore;
}

/**
 * Represents a handle to a grade request made on one commit.
 */
interface GradeHandle {
  /** URL of commit. */
  commitUrl: string;
  /** URL of posted comment specifying CI tests URL. */
  testsCommentUrl: string;
  /** Handle to perform actual scoring and posting of commit grade. */
  calculateAndPostGrade: () => Promise<api.CommentScoreResult>;
  /** Position of commit being graded, in terms of total number of commits. */
  position: {at: number, total: number};
}

/**
 * Represents an iterable grader. See `Grader` for an implementation.
 */
interface GradeHandleIterator {
  [Symbol.asyncIterator](): AsyncIterableIterator<GradeHandle>;
}

/**
 * The core request handler for gradec, operating as a stateful iterator of
 * `GradeHandle`s to various assignments.
 * A common usage of a grader is to create one for a subset of assignments and
 * iterate over the Grader's assignment handles.
 *
 *   const grader = new Grader(...);
 *   for (const assignmentHandle of grader) {
 *     doWork(assignmentHandle);
 *   }
 *
 */
export class Grader implements GradeHandleIterator {
  /**
   * Creates an iterable from a list of commit metadata and range of indexes in
   * the commit metadata list to grade.
   *
   * The returned iterable grader will only grade commits that are in the range
   * [start, end] of the commitsMeta list and that have not already been graded.
   */
  public static async makeGrader(
      commitsFile: string,
      testsFile: string,
      bounds: {readonly start: number, readonly end: number},
      accessToken: string,
      ): Promise<{grader: Grader, errors: string[]}> {
    const {commits, tests} = getSubmissions(commitsFile, testsFile);

    const assignments: api.CommitMetadata[] = [];
    const errors: string[] = [];
    for (let i = bounds.start; i < commits.length && i <= bounds.end; ++i) {
      const record = commits[i];
      // TODO: consider supporting non-GitHub (GitLab?) URLs.
      const match = record.url.match(RE_GH_COMMIT)!;
      if (!match) {
        errors.push(`GitHub commit missing for ${record.author}`);
        continue;
      }
      const [, repo, commit] = match;
      const meta: api.CommitMetadata = {
        author: record.author,
        commit,
        commitUrl: commits[i].url,
        repo,
        testsUrl: tests[i].url,
      };

      assignments.push(meta);
    }

    // Filter out all commits that are already graded, initiliazing a grader
    // with only the ungraded commits.
    const assignmentGrades = await Promise.all(
        assignments.map(commit => getExistingGrade(accessToken, commit)));
    const unscoredAssignments =
        assignments.filter((_, i) => assignmentGrades[i] === undefined);

    return {grader: new Grader(unscoredAssignments, accessToken), errors};
  }

  private constructor(
      private readonly assignments: api.CommitMetadata[],
      private readonly token: string,
  ) {}

  /**
   * Gets information about any already-known final scores in the assignments.
   */
  public getAssignmentScores():
      Promise<ReadonlyArray<{author: string, score: number|undefined}>> {
    return Promise.all(this.assignments.map(async (commit) => {
      const score = await getExistingGrade(this.token, commit);
      return {author: commit.author, score};
    }));
  }

  /**
   * Iterates over all commits in the Grader, generating a GradeHandle for each.
   */
  public async * [Symbol.asyncIterator]() {
    const total = this.assignments.length;
    for (let i = 0; i < total; ++i) {
      const commit = this.assignments[i];

      // Find the comment that points to the tests URL, if it has been posted
      // before (this can happen when someone quits grading an assignment after
      // it has been opened).
      let testsComment =
          (await getComments(this.token, commit))
              .find((comment) => comment.body.startsWith(TESTS_PREFIX));
      if (!testsComment) {
        // Tests URL comment doesn't exist; post it.
        testsComment = await postComment(
            this.token, commit, `${TESTS_PREFIX} ${commit.testsUrl}`);
      }

      const calculateAndPostGrade =
          async(): Promise<api.CommentScoreResult> => {
        const score = await gradeAssignment(this.token, commit);
        const scoreStr = score === MAXSCORE ? '💯' : `${score}/${MAXSCORE}`;
        const finalScoreComment = `${SCORE_PREFIX} ${scoreStr}`;
        const postingResult =
            await postComment(this.token, commit, finalScoreComment);

        return {comment: finalScoreComment, score, url: postingResult.html_url};
      };

      const handle: GradeHandle = {
        calculateAndPostGrade,
        commitUrl: commit.commitUrl,
        position: {
          at: i + 1,  // line number of assignment being graded (1-index)
          total,
        },
        testsCommentUrl: testsComment.html_url,
      };

      yield handle;
    }
  }
}

export const TEST_ONLY = {
  SCORE_PREFIX,
  TESTS_PREFIX
};
