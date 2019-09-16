import * as rp from 'request-promise';
import * as api from './api';

const MAXSCORE: number = Number(process.env.MAXSCORE || 100);
export const SCORE_PREFIX = 'Score:';
export const TESTS_PREFIX = 'CI tests at';

/**
 * Creates a GitHub commit comments request object from some request metadata.
 * See `makeCommitRequestMetadata` for more details on the metadata.
 */
export function makeRequest({
  accessToken,
  repo,
  commit,
  message,
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
  return request;
}

/**
 * Creates metadata for a request to be made about a commit.
 */
export function makeCommitRequestMetadata(
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
 *
 * @param metadata metadata about the commit being requested; see
 *     `makeCommitRequestMetadata` for more details
 * @return promise containing all comments on the commit
 */
export async function getComments(metadata: api.RequestMetadata):
    Promise<api.CommitCommentsResponse[]> {
  return rp.get(makeRequest(metadata)).catch(Grader.onError);
}

/**
 * Posts a comment on a particular commit, but not on any particular line or
 * file in the commit.
 *
 * @param metadata metadata about the commit being requested; see
 *     `makeCommitRequestMetadata` for more details
 * @param comment comment to make
 * @return promise containing response of posting the comment
 */
async function postComment(options: api.RequestMetadata, comment: string):
    Promise<api.CommitCommentsResponse> {
  return rp.post(makeRequest({...options, message: comment}))
      .promise()
      .catch(Grader.onError);
}

/**
 * Maps all comments on a commit to their score if the comment is a score
 * comment, or to `undefined` otherwise.
 *
 * @param metadata metadata about the commit being requested; see
 *     `makeCommitRequestMetadata` for more details
 * @param promise containing all comments mapped to their score comment or
 *     `undefined` if the comment is not a score comment
 */
export async function getScoreComments(metadata: api.RequestMetadata):
    Promise<Array<number|undefined>> {
  return getComments(metadata).then(
      (comments) => comments.map(
          (comment) => !comment.path && comment.body.startsWith(SCORE_PREFIX) ?
              Number(comment.body.split(SCORE_PREFIX)[1].split('/')[0].trim()) :
              undefined));
}

/**
 * Returns whether or not a commit already has a score comment. If it
 * does, it probably should not be considered for grading.
 *
 * @param metadata metadata about the commit being requested; see
 *     `makeCommitRequestMetadata` for more details
 */
async function hasScoreComment(metadata: api.RequestMetadata):
    Promise<boolean> {
  return getScoreComments(metadata).then(
      (comments) => !!comments.find((comment) => !!comment));
}

/**
 * Reads comments of form
 *   ([+|-]\d*)(:.*)?
 *   ^^^^^^^^^^------- $SCORE
 *             ^^^^^-- $COMMENT
 * on the commit and accumulates discovered $SCORES on MAX_SCORE.
 *
 * @param metadata metadata about the commit being requested; see
 *     `makeCommitRequestMetadata` for more details
 * @return promise containing total calculated score
 */
async function scoreComments(metadata: api.RequestMetadata): Promise<number> {
  const SCORE_COMMENT_GRAMMAR = /([+|-]\d*)(:.*)?/;
  const comments: api.CommitCommentsResponse[] =
      await rp.get(makeRequest(metadata)).catch(Grader.onError);

  const totalScore = comments.reduce((res, comment) => {
    const match = comment.body.match(SCORE_COMMENT_GRAMMAR);
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

/**
 * Represents an iterable grader. See `Grader` for an implementation.
 */
export interface GradeHandleIterator {
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
              return hasScoreComment(meta);
            }))
            // Keep the commits that don't already have a score.
            .then((hasScoreList) => cands.filter(() => !hasScoreList.shift()));

    return new Grader(accessToken, toGrade);
  }

  /**
   * Request error handler. This is reset everytime a new grader is created by
   * `makeGrader`.
   *
   * TODO: make this non-static so multiple Graders can be used at once.
   */
  public static onError: (err: api.CommitCommentsError) => number =
      () => {
        return 0;
      }

  /**
   * Constructs a Grader from a GitHub access token and a list of commits to
   * grade.
   *
   * Use `Grader#makeGrader` to create a public instance of a Grader.
   */
  private constructor(
      /** GitHub personal access token. */
      private readonly accessToken: string,
      /** Commits to grade. */
      private readonly commits: api.CommitMetadata[],
  ) {}

  /**
   * Iterates over all commits in the Grader, generating a GradeHandle for each.
   */
  public async * [Symbol.asyncIterator]() {
    const total = this.commits.length;
    for (let i = 0; i < total; ++i) {
      const commit = this.commits[i];
      const requestMeta = makeCommitRequestMetadata(this.accessToken, commit);

      // Find the comment that points to the tests URL, if it has been posted
      // before (this can happen when someone quits grading an assignment after
      // it has been opened).
      let testsComment =
          (await getComments(requestMeta))
              .find((comment) => comment.body.startsWith(TESTS_PREFIX));
      if (!testsComment) {
        // Tests URL comment doesn't exist; post it.
        testsComment = await postComment(
            {...requestMeta}, `${TESTS_PREFIX} ${commit.testsUrl}`);
      }

      // Handle to calculate and post a grade on a commit, determined by
      // accumulating score comments on that commit.
      // Returns a promise to the result of scoring the commit.
      async function calculateAndPostGrade(): Promise<api.CommentScoreResult> {
        const score = await scoreComments(requestMeta);
        const finalScoreComment = `${SCORE_PREFIX} ${score}/${MAXSCORE}`;
        const postingResult = await postComment(requestMeta, finalScoreComment);

        return {comment: finalScoreComment, score, url: postingResult.html_url};
      }

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
