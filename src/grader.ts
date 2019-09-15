import * as rp from 'request-promise';
import * as api from './api';

const MAXSCORE: number = Number(process.env.MAXSCORE || 100);
const SCORE_PREFIX = 'Score:';
const TESTS_PREFIX = 'CI tests at';

function makeRequest({
  accessToken,
  repo,
  commit,
  message,
  position,
}: api.RequestMetadata): api.CommitCommentsRequest {
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
  if (position) {
    request.body.position = position;
  }
  return request;
}

/**
 * Creates metadata for a request to be made about a commit.
 */
function makeCommitRequestMetadata(
    accessToken: string, commitMeta: api.CommitMetadata): api.RequestMetadata {
  const {commit, repo} = commitMeta;
  return {
    accessToken,
    commit,
    repo,
  };
}

/**
 * Gets all the comments on a particular commit.
 */
async function getComments(options: api.RequestMetadata):
    Promise<api.CommitCommentsResponse[]> {
  return rp.get(makeRequest(options)).catch(Grader.onError);
}

/**
 * Posts a comment onto a particular commit.
 */
async function postComment(
    options: api.RequestMetadata, comment: string,
    position?: number): Promise<api.CommitCommentsResponse> {
  return rp.post(makeRequest({...options, message: comment, position}))
      .promise()
      .catch(Grader.onError);
}

/**
 * Returns whether or not a commit already has a score comment. If it
 * does, it probably should not be considered for grading.
 */
async function hasScoreComment(options: api.RequestMetadata): Promise<boolean> {
  return getComments(options).then(
      (comments) =>
          comments.find(
              // Look for any comment that is commit comment (not on any
              // particular file) and marks the score of the commit.
              (comment) => !comment.path &&
                  comment.body.startsWith(SCORE_PREFIX)) !== undefined);
}

/**
 * Reads comments of form
 *   ([+|-]\d*)(:.*)?
 *   ^^^^^^^^^^------- $SCORE
 *             ^^^^^-- $COMMENT
 * on the commit and accumulates discovered $SCORES on
 * MAX_SCORE. Returns the total calculated score.
 */
async function scoreComments(options: api.RequestMetadata): Promise<number> {
  const SCORE_COMMENT_GRAMMAR = /([+|-]\d*)(:.*)?/;
  const comments: api.CommitCommentsResponse[] =
      await rp.get(makeRequest(options)).catch(Grader.onError);

  const partialScores = comments.reduce((res, comment) => {
    const match = comment.body.match(SCORE_COMMENT_GRAMMAR);
    if (match) {
      res.push(Number(match[1]));
    }
    return res;
  }, Array.from<number>({length: 0}));

  // Determine the final score by adding all partial scores (deductions or
  // additions) to the maximum score.
  const score = partialScores.reduce((total, part) => total + part, MAXSCORE);

  return score;
}

/**
 * Represents a handle to a grade request made on one commit.
 */
export interface GradeHandle {
  /** URL of commit. */
  commitUrl: string;
  /** URL of posted comment specifying CI tests URL. */
  testsCommentUrl: string;
  /** Handle to perform actual scoring and posting of commit grade. */
  calculateAndPostGrade: () => Promise<api.CommentScoreResult>;
  /** Position of commit being graded, in terms of total number of commits. */
  position: {at: number, total: number};
}

export interface GradeHandleIterator {
  [Symbol.asyncIterator](): AsyncIterableIterator<GradeHandle>;
}

/**
 * The core request handler for gradec, exposing APIs for scoring and posting to
 * commits, querying for new commit scores, and querying for processing state.
 */
export class Grader implements GradeHandleIterator {
  /**
   * Creates an iterable from a list of commit metadata and range of indexes in
   * the commit metadata list to grade.
   *
   * The returned iterable grader will only grade commits that are in the range
   * [start, end] of the commitsMeta list and that have not already been graded.
   *
   * @param commitMetas commit metadata to use in grading
   * @param start starting index of commit metadata to grade
   * @param end ending index of commit metadata to grade
   * @param accessToken GitHub access token to use in grading
   * @param onError callback invoked on a failed request, returning a status
   *     code.
   * @return iteratable grader
   */
  public static async makeGrader(
      commitMetas: api.CommitMetadata[], start: number, end: number,
      accessToken: string,
      onError: (err: api.CommitCommentsError) => number): Promise<Grader> {
    Grader.onError = onError;
    // Filter out all commits that are already graded, initiliazing a grader
    // with only the ungraded commits.
    const cands = commitMetas.slice(start, end + 1);
    const toGrade =
        await Promise
            .all(cands.map((commit) => {
              const meta = makeCommitRequestMetadata(accessToken, commit);
              return hasScoreComment(meta).then((hasScore) => !hasScore);
            }))
            .then((noScoreList) => cands.filter(() => noScoreList.shift()));

    return new Grader(accessToken, toGrade);
  }

  public static onError: (err: api.CommitCommentsError) => number =
      () => {
        return 0;
      }

  /**
   * Constructs a grader dameon (Grader) from a GitHub access token and a list
   * of commits to grade.
   *
   * Use `Grader#makeGrader` to create a public instance of a dameon.
   */
  private constructor(
      /** GitHub personal access token. */
      private readonly accessToken: string,
      /** Commits to grade. */
      private readonly commits: api.CommitMetadata[],
  ) {}

  /**
   * Grades a repo commit, if it has not been graded already, providing the
   * grade as a commit comment.
   */
  public async * [Symbol.asyncIterator]() {
    const total = this.commits.length;
    for (let i = 0; i < total; ++i) {
      const commit = this.commits[i];
      const requestMeta = makeCommitRequestMetadata(this.accessToken, commit);

      // Find the comment that points to the tests URL, if it has been posted
      // before (this can happen when someone quits grading an assignment after
      // it has been opened). Otherwise, post the comment.
      let testsComment =
          (await getComments(requestMeta))
              .find((comment) => comment.body.startsWith(TESTS_PREFIX));
      if (!testsComment) {
        testsComment = await postComment(
            {...requestMeta}, `${TESTS_PREFIX} ${commit.testsUrl}`, 0);
      }

      async function calculateAndPostGrade(): Promise<api.CommentScoreResult> {
        const score = await scoreComments(requestMeta);
        const comment = `${SCORE_PREFIX} ${score}/${MAXSCORE}`;
        const postResult = await postComment(requestMeta, comment);

        return {comment, score, url: postResult.html_url};
      }

      const handle: GradeHandle = {
        calculateAndPostGrade,
        commitUrl: commit.commitUrl,
        position: {
          at: i + 1,
          total,
        },
        testsCommentUrl: testsComment.html_url,
      };

      yield handle;
    }
  }
}
